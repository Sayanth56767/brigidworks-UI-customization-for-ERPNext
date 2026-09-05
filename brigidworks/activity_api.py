import frappe
from brigidworks.activity_logger import _is_noise


@frappe.whitelist()
def get_recent_activity(limit=20):
	"""Return the current user's most recent activity log entries,
	newest first, for rendering in the sidebar."""
	limit = frappe.utils.cint(limit) or 20
	limit = min(limit, 50)  # hard cap so nobody can request an absurd amount

	rows = frappe.get_all(
		"BW Activity Log",
		filters={"user": frappe.session.user},
		fields=["action", "reference_doctype", "reference_name", "subject", "creation"],
		order_by="creation desc",
		limit_page_length=limit,
	)

	for row in rows:
		row["time_ago"] = frappe.utils.pretty_date(row["creation"])
		if row["reference_doctype"] and row["reference_name"]:
			row["route"] = f"/app/{frappe.scrub(row['reference_doctype']).replace('_', '-')}/{row['reference_name']}"
		else:
			row["route"] = None

	return rows


@frappe.whitelist()
def log_view(reference_doctype, reference_name):
	"""Log that the current user opened a specific document. Called from
	the sidebar JS on every route change into a Form view."""
	if not reference_doctype or not reference_name:
		return
	if _is_noise(reference_doctype):
		return

	# Skip if we already logged ANYTHING for this exact record in the last
	# 60 seconds — prevents a Create immediately double-logging as a View,
	# and prevents rapid re-renders of the same form spamming the feed.
	recent = frappe.db.exists("BW Activity Log", {
		"user": frappe.session.user,
		"reference_doctype": reference_doctype,
		"reference_name": reference_name,
		"creation": [">", frappe.utils.add_to_date(frappe.utils.now(), seconds=-60)],
	})
	if recent:
		return

	try:
		title = None
		try:
			title = frappe.get_cached_doc(reference_doctype, reference_name).get_title()
		except Exception:
			pass
		subject = f"{reference_doctype}: {title or reference_name}"

		frappe.get_doc({
			"doctype": "BW Activity Log",
			"user": frappe.session.user,
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
			"action": "Viewed",
			"subject": subject,
		}).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(
			title="BW Activity Log view failed",
			message=frappe.get_traceback(),
		)
