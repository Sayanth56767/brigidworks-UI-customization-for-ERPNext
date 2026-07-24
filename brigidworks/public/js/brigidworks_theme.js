(function () {
	const theme = (frappe.boot && frappe.boot.brigidworks_theme) || {};

	const map = {
		bg_color: "--bg-color",
		fg_color: "--fg-color",
		navbar_bg: "--navbar-bg",
		card_bg: "--card-bg",
		modal_bg: "--modal-bg",
		popover_bg: "--popover-bg",
		control_bg: "--control-bg",
		control_bg_on_gray: "--control-bg-on-gray",
		subtle_accent: "--subtle-accent",
		subtle_fg: "--subtle-fg",
		fg_hover_color: "--fg-hover-color",
		highlight_color: "--highlight-color",
		primary_color: "--primary-color",
		btn_primary: "--btn-primary",
		btn_default_bg: "--btn-default-bg",
		btn_default_hover_bg: "--btn-default-hover-bg",
		border_color: "--border-color",
		dark_border_color: "--dark-border-color",
		table_border_color: "--table-border-color",
		border_primary: "--border-primary",
		sidebar_select_color: "--sidebar-select-color",
		navbar_height: "--navbar-height",
		icon_stroke: "--icon-stroke",
		icon_fill_bg: "--icon-fill-bg",
		scrollbar_thumb_color: "--scrollbar-thumb-color",
		scrollbar_track_color: "--scrollbar-track-color",
		alert_bg_danger: "--alert-bg-danger",
		alert_text_danger: "--alert-text-danger",
		alert_bg_warning: "--alert-bg-warning",
		alert_text_warning: "--alert-text-warning",
		alert_bg_info: "--alert-bg-info",
		alert_text_info: "--alert-text-info",
		alert_bg_success: "--alert-bg-success",
		alert_text_success: "--alert-text-success",
	};

	const root = document.documentElement;

	Object.keys(map).forEach(function (fieldname) {
		const value = theme[fieldname];
		if (value) {
			root.style.setProperty(map[fieldname], value);
		}
	});

	if (theme.custom_css) {
		const styleTag = document.createElement("style");
		styleTag.id = "brigidworks-custom-css";
		styleTag.innerHTML = theme.custom_css;
		document.head.appendChild(styleTag);
	}
})();
