import frappe
import json

# ---------------------------------------------------------------------------
# Doctypes considered "customizations" (metadata, not business data).
# ---------------------------------------------------------------------------
CUSTOMIZATION_MAP = {
	"client_script": [("Client Script", {})],
	"server_script": [("Server Script", {})],
	"custom_field": [("Custom Field", {"is_system_generated": 0})],
	"property_setter": [("Property Setter", {"is_system_generated": 0})],
	"workflow": [
		("Workflow", {}),
		("Workflow State", {}),
		("Workflow Action Master", {}),
	],
	"custom_doctype": [("DocType", {"custom": 1})],
	"roles_permissions": [
		("Role", {}),
		("Role Profile", {}),
		("Custom DocPerm", {}),
	],
}

# Never auto-suggested as a "linked doctype" in the Data section - Company is
# per-site setup you configure once, not something you clone between sites.
NEVER_AUTO_LINK = {"Company"}

# Import order: dependencies land before the things that reference them.
# Anything not listed here imports afterward, in whatever order it appears.
DEPENDENCY_ORDER = [
	"Role",
	"Role Profile",
	"Workflow State",
	"Workflow Action Master",
	"Workflow",
	"Custom DocPerm",
	"Property Setter",
	"Custom Field",
	"Client Script",
	"Server Script",
	"DocType",
]

# Source-site metadata that must NOT be reapplied onto an existing target
# record: "modified" breaks Frappe's edit-conflict check, "creation" is a
# locked field on any doc that already exists.
STRIP_ON_IMPORT = {"modified", "creation"}


@frappe.whitelist()
def export_customizations(selections):
	if isinstance(selections, str):
		selections = json.loads(selections)
	frappe.only_for("System Manager")

	bundle = _new_bundle()
	for key in selections:
		for doctype, filters in CUSTOMIZATION_MAP.get(key, []):
			_export_doctype(bundle, doctype, filters)
	return bundle


@frappe.whitelist()
def get_exportable_doctypes():
	frappe.only_for("System Manager")
	return frappe.get_all(
		"DocType",
		filters={"istable": 0, "issingle": 0},
		fields=["name", "module", "custom"],
		order_by="name asc"
	)


@frappe.whitelist()
def get_linked_doctypes(doctype):
	frappe.only_for("System Manager")
	meta = frappe.get_meta(doctype)
	linked = set()
	for df in meta.fields:
		if df.fieldtype == "Link" and df.options:
			linked.add(df.options)
	linked.discard(doctype)
	linked -= NEVER_AUTO_LINK
	return sorted(linked)


@frappe.whitelist()
def get_doctype_record_count(doctype):
	frappe.only_for("System Manager")
	return frappe.db.count(doctype)


@frappe.whitelist()
def export_data(doctypes):
	frappe.only_for("System Manager")
	if isinstance(doctypes, str):
		doctypes = json.loads(doctypes)

	bundle = _new_bundle()
	for doctype in doctypes:
		meta = frappe.get_meta(doctype)
		if meta.istable:
			continue
		_export_doctype(bundle, doctype, {})
	return bundle


def _new_bundle():
	return {
		"brigidworks_export_version": 1,
		"source_site": frappe.local.site,
		"exported_on": frappe.utils.now(),
		"data": {}
	}


def _export_doctype(bundle, doctype, filters):
	names = frappe.get_all(doctype, filters=filters, pluck="name")
	docs = [frappe.get_doc(doctype, name).as_dict() for name in names]
	bundle["data"].setdefault(doctype, []).extend(docs)


@frappe.whitelist()
def import_customizations(bundle, selections, mode="skip"):
	frappe.only_for("System Manager")

	if isinstance(bundle, str):
		bundle = json.loads(bundle)
	if isinstance(selections, str):
		selections = json.loads(selections)

	data = bundle.get("data", {})
	results = {"created": [], "skipped": [], "overwritten": [], "errors": []}

	ordered_doctypes = [dt for dt in DEPENDENCY_ORDER if dt in selections]
	ordered_doctypes += [dt for dt in selections if dt not in ordered_doctypes]

	for doctype in ordered_doctypes:
		for record in data.get(doctype, []):
			_import_one(doctype, record, mode, results)

	frappe.db.commit()
	return results


def _import_one(doctype, record, mode, results):
	name = record.get("name")
	label = f"{doctype}: {name}"
	try:
		record = dict(record)  # don't mutate the caller's data
		for field in STRIP_ON_IMPORT:
			record.pop(field, None)

		# If the source site's owner/modified_by user doesn't exist here
		# (very common moving dev -> prod), fall back to the current user
		# instead of failing the whole record.
		for user_field in ("owner", "modified_by"):
			user = record.get(user_field)
			if user and user != "Administrator" and not frappe.db.exists("User", user):
				record[user_field] = frappe.session.user

		exists = frappe.db.exists(doctype, name)

		if exists and mode == "skip":
			results["skipped"].append(label)
			return

		if exists and mode == "overwrite":
			if doctype == "DocType":
				frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
				doc = frappe.get_doc(record)
				doc.insert(ignore_permissions=True)
			else:
				doc = frappe.get_doc(doctype, name)
				doc.update(record)
				doc.flags.ignore_version = True
				doc.save(ignore_permissions=True)
			results["overwritten"].append(label)
		else:
			doc = frappe.get_doc(record)
			doc.insert(ignore_permissions=True)
			results["created"].append(label)

	except Exception:
		frappe.log_error(title="Brigidworks Import Error", message=frappe.get_traceback())
		results["errors"].append(label)
