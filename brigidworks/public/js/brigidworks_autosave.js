// brigidworks_autosave.js
// Autosaves draft documents a few seconds after the user stops editing.

(function () {
	// ---------- SETTINGS (edit these) ----------

	// true  = autosave on EVERY doctype except the ones in EXCLUDE_DOCTYPES
	// false = autosave ONLY on the doctypes in INCLUDE_DOCTYPES
	const AUTOSAVE_ALL_DOCTYPES = true;

	// Used when AUTOSAVE_ALL_DOCTYPES = false
	const INCLUDE_DOCTYPES = ["Purchase Order", "Item", "Work Order"];

	// Never autosave these (system / configuration doctypes).
	// Add any doctype name here to switch autosave off for it.
	const EXCLUDE_DOCTYPES = [
		"DocType",
		"User",
		"Role",
		"Custom Field",
		"Property Setter",
		"Client Script",
		"Server Script",
		"Workflow",
		"Print Format",
		"Report",
		"Data Import",
		"Data Export",
		"Deleted Document",
		"BW Activity Log",
	];

	// Seconds of inactivity before saving (in milliseconds).
	const DELAY_MS = 3000;

	// -------------------------------------------

	let timer = null;
	let last_user_input = 0;

	// Remember when the user last actually typed/clicked inside a form,
	// so we don't autosave just because ERPNext filled default values.
	function track_user_input() {
		$(document).on("input change keydown", ".form-layout", function () {
			last_user_input = Date.now();
		});
	}

	function is_enabled_for(frm) {
		if (!frm || !frm.meta) return false;
		if (frm.meta.issingle || frm.meta.istable) return false;
		if (EXCLUDE_DOCTYPES.includes(frm.doctype)) return false;
		if (AUTOSAVE_ALL_DOCTYPES) return true;
		return INCLUDE_DOCTYPES.includes(frm.doctype);
	}

	function is_empty(value) {
		return value === undefined || value === null || value === "";
	}

	// Returns true if any mandatory field (or mandatory child-table field) is empty.
	function has_missing_mandatory(frm) {
		const skip_types = ["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Heading"];

		for (const fieldname in frm.fields_dict) {
			const field = frm.fields_dict[fieldname];
			const df = field.df;
			if (!df || skip_types.includes(df.fieldtype)) continue;
			if (!df.reqd || df.hidden) continue;

			if (df.fieldtype === "Table") {
				const rows = frm.doc[df.fieldname] || [];
				if (!rows.length) return true;

				const child_fields = frappe.get_meta(df.options).fields || [];
				for (const row of rows) {
					for (const cdf of child_fields) {
						if (cdf.reqd && !cdf.hidden && !skip_types.includes(cdf.fieldtype)) {
							if (is_empty(row[cdf.fieldname])) return true;
						}
					}
				}
			} else if (is_empty(frm.doc[df.fieldname])) {
				return true;
			}
		}
		return false;
	}

	function can_autosave(frm) {
		if (!frm || !frm.doc) return false;
		if (!is_enabled_for(frm)) return false;
		if (frm.doc.docstatus !== 0) return false; // drafts only
		if (frm.save_disabled) return false;
		if (!frm.is_dirty()) return false;
		if ($(".modal.show").length) return false; // a dialog is open

		const allowed = frm.is_new()
			? frappe.model.can_create(frm.doctype)
			: frm.perm && frm.perm[0] && frm.perm[0].write;
		if (!allowed) return false;

		return !has_missing_mandatory(frm);
	}

	function do_autosave(frm) {
		// Make sure the user is still on the same form and nothing changed meanwhile.
		if (frm !== window.cur_frm) return;
		if (!can_autosave(frm)) return;

		frm.save("Save", function () {
			frappe.show_alert({ message: __("Draft autosaved"), indicator: "green" }, 3);
		});
	}

	function schedule(frm) {
		if (!is_enabled_for(frm)) return;
		// Ignore "dirty" caused by the system rather than the user.
		if (Date.now() - last_user_input > 5000) return;

		clearTimeout(timer);
		timer = setTimeout(function () {
			do_autosave(frm);
		}, DELAY_MS);
	}

	function install() {
		if (frappe.ui.form.Form.prototype.__bw_autosave_installed) return;
		frappe.ui.form.Form.prototype.__bw_autosave_installed = true;

		// frm.dirty() is called by Frappe every time any field changes.
		// We wrap it so every change also schedules an autosave.
		const original_dirty = frappe.ui.form.Form.prototype.dirty;
		frappe.ui.form.Form.prototype.dirty = function () {
			const result = original_dirty.apply(this, arguments);
			schedule(this);
			return result;
		};

		track_user_input();
	}

	if (frappe.ui && frappe.ui.form && frappe.ui.form.Form) {
		install();
	} else {
		$(document).on("startup", install);
	}
})();
