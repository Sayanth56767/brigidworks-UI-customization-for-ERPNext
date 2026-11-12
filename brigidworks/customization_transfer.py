# -*- coding: utf-8 -*-
"""
BW Customization Transfer - backend API.

Exports common customization doctypes from one site into a JSON bundle and
imports that bundle into another site. Runs entirely from the Desk UI, so it
works on Frappe Cloud where there is no terminal access.
"""
import frappe
from frappe.utils import cint, now_datetime

# What we export, and the filter that selects only the CUSTOM records
# (standard records that ship with apps are never exported).
EXPORT_FILTERS = {
	"DocType": {"custom": 1},
	"Custom Field": {},
	"Property Setter": {},
	"Custom DocPerm": {},
	"Client Script": {},
	"Server Script": {},
	"Print Format": {"standard": "No"},
	"Workflow": {},
	"Notification": {"is_standard": 0},
	"Report": {"is_standard": "No"},
	"Web Form": {"is_standard": 0},
}

# Helper records that other records depend on. Always imported in
# "skip existing" mode, never overwritten.
DEPENDENCY_TYPES = ["Role", "Workflow State", "Workflow Action Master"]

# Order matters: things that others depend on come first.
IMPORT_ORDER = [
	"Role",
	"Workflow State",
	"Workflow Action Master",
	"DocType",
	"Custom Field",
	"Property Setter",
	"Custom DocPerm",
	"Client Script",
	"Server Script",
	"Print Format",
	"Workflow",
	"Notification",
	"Report",
	"Web Form",
]

# Fields removed from every exported record (they differ between sites).
TOP_STRIP = {
	"owner", "creation", "modified", "modified_by", "docstatus",
	"_user_tags", "_comments", "_assign", "_liked_by",
}
# Extra fields removed from child-table rows.
CHILD_STRIP = TOP_STRIP | {"name", "parent", "parenttype", "parentfield"}


def _clean(data, is_child=False):
	"""Return a copy of a doc dict without site-specific fields."""
	strip = CHILD_STRIP if is_child else TOP_STRIP
	out = {}
	for key, value in data.items():
		if key in strip:
			continue
		if isinstance(value, list):
			out[key] = [_clean(row, True) for row in value if isinstance(row, dict)]
		else:
			out[key] = value
	return out


def _export_doc(doctype, name):
	doc = frappe.get_doc(doctype, name)
	return _clean(doc.as_dict(convert_dates_to_str=True, no_nulls=True))


def _collect_dependencies(records):
	"""Find Roles / Workflow States / Workflow Actions used by the exported records."""
	roles, states, actions = set(), set(), set()

	for d in records.get("Custom DocPerm", []):
		if d.get("role"):
			roles.add(d["role"])

	for d in records.get("DocType", []):
		for p in d.get("permissions") or []:
			if p.get("role"):
				roles.add(p["role"])

	for d in records.get("Workflow", []):
		for s in d.get("states") or []:
			if s.get("state"):
				states.add(s["state"])
			if s.get("allow_edit"):
				roles.add(s["allow_edit"])
		for t in d.get("transitions") or []:
			if t.get("state"):
				states.add(t["state"])
			if t.get("next_state"):
				states.add(t["next_state"])
			if t.get("action"):
				actions.add(t["action"])
			if t.get("allowed"):
				roles.add(t["allowed"])

	return roles, states, actions


@frappe.whitelist()
def get_exportable_counts():
	"""How many custom records of each type exist on this site."""
	frappe.only_for("System Manager")
	return {dt: frappe.db.count(dt, filters) for dt, filters in EXPORT_FILTERS.items()}


@frappe.whitelist()
def export_customizations(doctypes):
	"""Build the JSON bundle for the selected doctypes."""
	frappe.only_for("System Manager")
	selected = frappe.parse_json(doctypes) or []

	records = {}
	for dt in EXPORT_FILTERS:  # keeps a stable, predictable order
		if dt not in selected:
			continue
		names = frappe.get_all(
			dt, filters=EXPORT_FILTERS[dt], pluck="name", order_by="creation asc"
		)
		records[dt] = [_export_doc(dt, n) for n in names]

	# Pull in the helper records the exported data points to.
	roles, states, actions = _collect_dependencies(records)
	for dt, names in (
		("Role", roles),
		("Workflow State", states),
		("Workflow Action Master", actions),
	):
		items = []
		for n in sorted(names):
			if frappe.db.exists(dt, n):
				items.append(_export_doc(dt, n))
		if items:
			records[dt] = items

	return {
		"meta": {
			"tool": "brigidworks.customization_transfer",
			"format_version": 1,
			"source_site": frappe.local.site,
			"frappe_version": frappe.__version__,
			"exported_on": str(now_datetime()),
			"counts": {dt: len(rows) for dt, rows in records.items()},
		},
		"records": records,
	}


def _find_existing(dt, data):
	"""Return the name of the matching record on this site, or None."""
	if dt == "Custom DocPerm":
		# Custom DocPerm names are random hashes, so match on what makes it unique.
		return frappe.db.get_value(
			"Custom DocPerm",
			{
				"parent": data.get("parent"),
				"role": data.get("role"),
				"permlevel": cint(data.get("permlevel")),
				"if_owner": cint(data.get("if_owner")),
			},
			"name",
		)
	name = data.get("name")
	if name and frappe.db.exists(dt, name):
		return name
	return None


def _process_one(dt, data, overwrite, dry_run):
	"""Import a single record. Returns 'created', 'updated' or 'skipped'."""
	existing = _find_existing(dt, data)

	if existing:
		if not overwrite or dt in DEPENDENCY_TYPES:
			return "skipped"
		if dry_run:
			return "updated"
		doc = frappe.get_doc(dt, existing)
		doc.update({k: v for k, v in data.items() if k not in ("name", "doctype")})
		doc.save(ignore_permissions=True)
		return "updated"

	if dry_run:
		return "created"

	values = dict(data)
	values["doctype"] = dt
	if dt == "Custom DocPerm":
		values.pop("name", None)  # let Frappe generate a fresh hash name

	doc = frappe.get_doc(values)
	frappe.flags.in_import = True  # keeps the record's original name
	try:
		doc.insert(ignore_permissions=True)
	finally:
		frappe.flags.in_import = False
	return "created"


@frappe.whitelist()
def import_customizations(payload, mode="Skip existing", dry_run=0):
	"""Import a bundle produced by export_customizations."""
	frappe.only_for("System Manager")

	bundle = frappe.parse_json(payload)
	if not isinstance(bundle, dict) or "records" not in bundle:
		frappe.throw("This does not look like a valid customization export file.")

	records = bundle["records"]
	overwrite = mode == "Overwrite existing"
	dry_run = cint(dry_run)

	summary = {"created": 0, "updated": 0, "skipped": 0, "failed": 0}
	details = []

	def run(dt, data):
		name = data.get("name") or "(auto)"
		try:
			result = _process_one(dt, data, overwrite, dry_run)
			if not dry_run:
				frappe.db.commit()
			summary[result] += 1
			details.append([dt, name, result, ""])
			return True
		except Exception as e:
			frappe.db.rollback()
			frappe.clear_messages()
			summary["failed"] += 1
			details.append([dt, name, "failed", str(e)[:300]])
			return False

	for dt in IMPORT_ORDER:
		rows = records.get(dt) or []
		if dt == "DocType":
			# Custom DocTypes may depend on each other (child tables, links),
			# so keep retrying the failures until no more progress is made.
			pending = list(rows)
			for _pass in range(5):
				still_failing = []
				for data in pending:
					before = len(details)
					if not run(dt, data):
						still_failing.append((data, before))
				if not still_failing or len(still_failing) == len(pending):
					break
				# Forget the failure rows of ones we are about to retry.
				for _data, idx in sorted(still_failing, key=lambda x: -x[1]):
					del details[idx]
					summary["failed"] -= 1
				pending = [d for d, _ in still_failing]
		else:
			for data in rows:
				run(dt, data)

	if not dry_run:
		frappe.clear_cache()

	return {"dry_run": dry_run, "mode": mode, "summary": summary, "details": details}
