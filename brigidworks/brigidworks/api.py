import frappe
import json

# Maps each checkbox key (from the JS) to the real Frappe doctype(s) behind it.
# "filters" narrows it down where needed (e.g. only CUSTOM doctypes, not core ones).
CUSTOMIZATION_MAP = {
	"client_script": [("Client Script", {})],
	"server_script": [("Server Script", {})],
	"custom_field": [("Custom Field", {"is_system_generated": 0})],
	"property_setter": [("Property Setter", {"is_system_generated": 0})],
	"workflow": [("Workflow", {})],
	"custom_doctype": [("DocType", {"custom": 1})],
}

@frappe.whitelist()
def export_customizations(selections):
	# selections arrives as a JSON string from the browser - convert to a Python list
	if isinstance(selections, str):
		selections = json.loads(selections)

	# Hard server-side guard: even though the Page is restricted to System Manager,
	# we double-check here too, since API methods can technically be called directly.
	frappe.only_for("System Manager")

	bundle = {
		"brigidworks_export_version": 1,
		"source_site": frappe.local.site,
		"exported_on": frappe.utils.now(),
		"data": {}
	}

	for key in selections:
		specs = CUSTOMIZATION_MAP.get(key)
		if not specs:
			continue
		for doctype, filters in specs:
			names = frappe.get_all(doctype, filters=filters, pluck="name")
			docs = []
			for name in names:
				# get_doc (not get_all) so we capture child tables too -
				# e.g. a Workflow's states/transitions, a custom DocType's fields/permissions
				doc = frappe.get_doc(doctype, name)
				docs.append(doc.as_dict())
			bundle["data"].setdefault(doctype, []).extend(docs)

	return bundle
	
@frappe.whitelist()
def import_customizations(bundle, selections, mode="skip"):
	frappe.only_for("System Manager")

	if isinstance(bundle, str):
		bundle = json.loads(bundle)
	if isinstance(selections, str):
		selections = json.loads(selections)

	data = bundle.get("data", {})
	results = {"created": [], "skipped": [], "overwritten": [], "errors": []}

	for doctype in selections:
		records = data.get(doctype, [])
		for record in records:
			name = record.get("name")
			try:
				exists = frappe.db.exists(doctype, name)

				if exists and mode == "skip":
					results["skipped"].append(f"{doctype}: {name}")
					continue

				if exists and mode == "overwrite":
					if doctype == "DocType":
						# Structural doctypes: safest reliable overwrite is delete + recreate.
						# WARNING: this drops the doctype's real data table if any records exist in it.
						frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
						doc = frappe.get_doc(record)
						doc.insert(ignore_permissions=True)
					else:
						doc = frappe.get_doc(doctype, name)
						doc.update(record)
						doc.save(ignore_permissions=True)
					results["overwritten"].append(f"{doctype}: {name}")
				else:
					doc = frappe.get_doc(record)
					doc.insert(ignore_permissions=True)
					results["created"].append(f"{doctype}: {name}")

			except Exception:
				frappe.log_error(title="Brigidworks Import Error", message=frappe.get_traceback())
				results["errors"].append(f"{doctype}: {name}")

	frappe.db.commit()
	return results

@frappe.whitelist()
def get_exportable_doctypes():
	# Powers the search box in the Data section - excludes child tables (istable=1,
	# since those only make sense attached to a parent) and Singles (issingle=1,
	# since those are settings-style docs, not "records" you'd bulk export).
	frappe.only_for("System Manager")
	return frappe.get_all(
		"DocType",
		filters={"istable": 0, "issingle": 0},
		fields=["name", "module", "custom"],
		order_by="name asc"
	)

@frappe.whitelist()
def get_linked_doctypes(doctype):
	# Looks at every Link field on the given doctype and returns the doctypes
	# it points to - e.g. Sales Order -> ["Customer", "Company", ...]
	frappe.only_for("System Manager")
	meta = frappe.get_meta(doctype)
	linked = set()
	for df in meta.fields:
		if df.fieldtype == "Link" and df.options:
			linked.add(df.options)
	linked.discard(doctype)
	return sorted(linked)

@frappe.whitelist()
def export_data(doctypes):
	# Same shape/logic as export_customizations, but for arbitrary doctypes
	# with no special filters - we want ALL real records of whatever you pick.
	frappe.only_for("System Manager")
	if isinstance(doctypes, str):
		doctypes = json.loads(doctypes)

	bundle = {
		"brigidworks_export_version": 1,
		"source_site": frappe.local.site,
		"exported_on": frappe.utils.now(),
		"data": {}
	}

	for doctype in doctypes:
		meta = frappe.get_meta(doctype)
		if meta.istable:
			continue  # safety net: child tables travel with their parent automatically
		names = frappe.get_all(doctype, pluck="name")
		docs = [frappe.get_doc(doctype, name).as_dict() for name in names]
		bundle["data"].setdefault(doctype, []).extend(docs)

	return bundle

@frappe.whitelist()
def get_doctype_record_count(doctype):
	frappe.only_for("System Manager")
	return frappe.db.count(doctype)
