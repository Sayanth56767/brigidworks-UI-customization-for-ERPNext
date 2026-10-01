app_name = "brigidworks"
app_title = "Brigidworks"
app_publisher = "Brigidworks"
app_description = "An All In One app for UI customization and managing data import/export"
app_email = "sayanthse419@gmail.com"
app_license = "mit"

app_include_js = [
	"/assets/brigidworks/js/brigidworks_theme.js",
	"/assets/brigidworks/js/brigidworks_activity_sidebar.js",
]

doc_events = {
	"*": {
		"after_insert": "brigidworks.activity_logger.log_create",
		"on_update": "brigidworks.activity_logger.log_update",
		"on_trash": "brigidworks.activity_logger.cleanup_activity_log",
	}
}

extend_bootinfo = "brigidworks.boot.boot_session"
