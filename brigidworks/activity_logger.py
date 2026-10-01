import frappe

# Doctypes we never want to log — either because they ARE logs themselves
# (which would cause infinite loops / pointless noise), because they're
# framework plumbing nobody wants in a "recent history" feed, or because
# they're dev/customization actions (building brigidworks itself) rather
# than normal business activity.
EXCLUDED_DOCTYPES = {
	"BW Activity Log",
	"Version",
	"View Log",
	"Access Log",
	"Error Log",
	"Activity Log",
	"Route History",
	"Comment",
	"Communication",
	"Email Queue",
	"Notification Log",
	"DocShare",
	"Document Follow",
	"Deleted Document",
	"Scheduled Job Log",
	"Prepared Report",
	"Bulk Update",
	"Page",
	"Report",
	"Print Format",
	"Client Script",
	"Server Script",
	"Custom Field",
	"Property Setter",
	"Workflow",
	"Workflow State",
	"Workflow Action Master",
	"DocType",
	"Role",
	"Role Profile",
	"Custom DocPerm",
}


def _is_noise(doctype):
	if doctype in EXCLUDED_DOCTYPES:
		return True
	try:
		# Singles (Settings-style doctypes with exactly one record) are
		# system config, not user activity worth showing in the feed.
		return bool(frappe.get_meta(doctype).issingle)
	except Exception:
		return False


def _write_log(doc, action):
	"""Insert one BW Activity Log row. Wrapped in try/except so that if
	logging ever fails, it NEVER breaks the user's actual save/transaction."""
	if _is_noise(doc.doctype):
		return
	try:
		title = None
		try:
			title = doc.get_title()
		except Exception:
			pass
		subject = f"{doc.doctype}: {title or doc.name}"

		frappe.get_doc({
			"doctype": "BW Activity Log",
			"user": frappe.session.user,
			"reference_doctype": doc.doctype,
			"reference_name": doc.name,
			"action": action,
			"subject": subject,
		}).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(
			title="BW Activity Log failed",
			message=frappe.get_traceback(),
		)


def log_create(doc, method=None):
	_write_log(doc, "Created")


def log_update(doc, method=None):
	# Frappe fires on_update for BOTH a brand-new insert AND a normal update.
	# doc.flags.in_insert is True while we're still inside the initial insert
	# flow, so this check stops a fresh Create from also logging as "Updated".
	if doc.flags.in_insert:
		return
	_write_log(doc, "Updated")


def cleanup_activity_log(doc, method=None):
	"""Runs on `on_trash`, which fires BEFORE Frappe's link-existence check
	during delete. Wipes this document's own history rows so a document's
	own activity log entries can never block its own deletion."""
	if doc.doctype == "BW Activity Log":
		return
	frappe.db.delete("BW Activity Log", {
		"reference_doctype": doc.doctype,
		"reference_name": doc.name,
	})
