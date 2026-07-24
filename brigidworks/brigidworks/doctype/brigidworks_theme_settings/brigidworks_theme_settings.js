frappe.ui.form.on('Brigidworks Theme Settings', {
	after_save: function (frm) {
		frappe.show_alert({ message: 'Theme updated. Reloading to apply changes...', indicator: 'green' });
		setTimeout(function () {
			location.reload();
		}, 800);
	}
});
