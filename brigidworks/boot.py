import frappe


def boot_session(bootinfo):
	try:
		settings = frappe.get_cached_doc("Brigidworks Theme Settings")
		bootinfo.brigidworks_theme = settings.as_dict()
	except Exception:
		bootinfo.brigidworks_theme = {}
