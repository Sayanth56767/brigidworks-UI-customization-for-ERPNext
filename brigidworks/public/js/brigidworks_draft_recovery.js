// brigidworks_draft_recovery.js
// Keeps a copy of unsaved form data in the browser (localStorage)
// and offers to restore it if the page was closed/refreshed/disconnected.

(function () {
	// ---------- SETTINGS (edit these) ----------

	// true  = works on EVERY doctype except those in EXCLUDE_DOCTYPES
	// false = works ONLY on the doctypes in INCLUDE_DOCTYPES
	const RECOVER_ALL_DOCTYPES = true;

	const INCLUDE_DOCTYPES = ["Purchase Order", "Item", "Work Order"];

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

	// How long after the last change to store the copy (milliseconds).
	const SAVE_DELAY_MS = 1000;

	// Drafts older than this are thrown away (7 days).
	const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

	// -------------------------------------------

	const PREFIX = "bw_draft::";
	const LAYOUT_TYPES = ["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Heading"];
	const TABLE_TYPES = ["Table", "Table MultiSelect"];
	const SYSTEM_FIELDS = [
		"name", "owner", "creation", "modified", "modified_by", "docstatus",
		"idx", "doctype", "parent", "parenttype", "parentfield",
	];

	let timer = null;

	// ---------- helpers ----------

	function is_enabled_for(frm) {
		if (!frm || !frm.meta) return false;
		if (frm.meta.issingle || frm.meta.istable) return false;
		if (EXCLUDE_DOCTYPES.includes(frm.doctype)) return false;
		if (RECOVER_ALL_DOCTYPES) return true;
		return INCLUDE_DOCTYPES.includes(frm.doctype);
	}

	function draft_key(frm) {
		const id = frm.is_new() ? "__new__" : frm.doc.name;
		return PREFIX + frappe.session.user + "::" + frm.doctype + "::" + id;
	}

	function is_empty(v) {
		return v === undefined || v === null || v === "";
	}

	function clean_row(row) {
		const out = {};
		Object.keys(row).forEach(function (k) {
			if (k.startsWith("__") || SYSTEM_FIELDS.includes(k)) return;
			out[k] = row[k];
		});
		return out;
	}

	function normalise(df, value) {
		if (TABLE_TYPES.includes(df.fieldtype)) {
			return JSON.stringify((value || []).map(clean_row));
		}
		return is_empty(value) ? "" : JSON.stringify(value);
	}

	// ---------- storage ----------

	function write_draft(frm) {
		if (!frm || !frm.doc || !is_enabled_for(frm)) return;
		if (frm.doc.docstatus !== 0) return;
		if (!frm.__bw_user_touched || !frm.is_dirty()) return;

		try {
			const snapshot = {};
			Object.keys(frm.doc).forEach(function (k) {
				if (!k.startsWith("__")) snapshot[k] = frm.doc[k];
			});
			localStorage.setItem(
				draft_key(frm),
				JSON.stringify({
					saved_at: Date.now(),
					modified: frm.doc.modified || null,
					doc: snapshot,
				})
			);
		} catch (e) {
			console.warn("Brigidworks draft recovery: could not store draft", e);
		}
	}

	function read_draft(key) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return null;
			const draft = JSON.parse(raw);
			if (!draft || Date.now() - draft.saved_at > EXPIRY_MS) {
				localStorage.removeItem(key);
				return null;
			}
			return draft;
		} catch (e) {
			return null;
		}
	}

	function remove_draft(key) {
		try {
			localStorage.removeItem(key);
		} catch (e) {}
	}

	function purge_expired() {
		try {
			Object.keys(localStorage).forEach(function (k) {
				if (k.startsWith(PREFIX)) read_draft(k); // read_draft deletes expired ones
			});
		} catch (e) {}
	}

	// ---------- compare & restore ----------

	// Which editable fields differ between the stored draft and the form right now?
	function diff_fields(frm, draft) {
		const changed = [];
		Object.keys(frm.fields_dict).forEach(function (fn) {
			const df = frm.fields_dict[fn].df;
			if (!df || LAYOUT_TYPES.includes(df.fieldtype)) return;
			if (df.read_only || SYSTEM_FIELDS.includes(fn)) return;
			if (!(fn in draft.doc)) return;
			if (normalise(df, frm.doc[fn]) !== normalise(df, draft.doc[fn])) changed.push(fn);
		});
		return changed;
	}

	function restore(frm, draft) {
		const fields = diff_fields(frm, draft);
		frm.__bw_user_touched = true;

		let chain = Promise.resolve();
		fields.forEach(function (fn) {
			const df = frm.fields_dict[fn].df;
			chain = chain.then(function () {
				if (TABLE_TYPES.includes(df.fieldtype)) {
					frm.clear_table(fn);
					(draft.doc[fn] || []).forEach(function (row) {
						frm.add_child(fn, clean_row(row));
					});
					frm.refresh_field(fn);
				} else {
					return frm.set_value(fn, draft.doc[fn]);
				}
			});
		});

		chain.then(function () {
			frappe.show_alert({ message: __("Unsaved changes restored"), indicator: "green" }, 4);
		});
	}

	function maybe_offer_restore(frm) {
		if (!is_enabled_for(frm) || !frm.doc || frm.doc.docstatus !== 0) return;
		if (frm.__bw_draft_checked === frm.docname) return;
		frm.__bw_draft_checked = frm.docname;

		// Small delay so the form finishes loading before we look at it.
		setTimeout(function () {
			if (frm !== window.cur_frm) return;

			const key = draft_key(frm);
			const draft = read_draft(key);
			if (!draft) return;

			if (!diff_fields(frm, draft).length) {
				remove_draft(key);
				return;
			}

			let msg = __("Unsaved changes from {0} were found for this form. Restore them?", [
				new Date(draft.saved_at).toLocaleString(),
			]);
			if (!frm.is_new() && draft.modified && draft.modified !== frm.doc.modified) {
				msg += "<br><br><b>" + __("Note: this document was changed on the server after your draft was stored.") + "</b>";
			}

			frappe.confirm(
				msg,
				function () { restore(frm, draft); },
				function () { remove_draft(key); }
			);
		}, 600);
	}

	// ---------- scheduling ----------

	function schedule(frm) {
		if (!is_enabled_for(frm) || !frm.__bw_user_touched) return;
		clearTimeout(timer);
		timer = setTimeout(function () { write_draft(frm); }, SAVE_DELAY_MS);
	}

	function flush() {
		clearTimeout(timer);
		if (window.cur_frm) write_draft(window.cur_frm);
	}

	// ---------- install ----------

	function install() {
		const P = frappe.ui.form.Form.prototype;
		if (P.__bw_draft_installed) return;
		P.__bw_draft_installed = true;

		// 1. Every field change calls frm.dirty() -> schedule a local copy.
		const orig_dirty = P.dirty;
		P.dirty = function () {
			const result = orig_dirty.apply(this, arguments);
			schedule(this);
			return result;
		};

		// 2. Whenever a form is shown, check whether a stored draft exists.
		const orig_refresh = P.refresh;
		P.refresh = function () {
			const result = orig_refresh.apply(this, arguments);
			maybe_offer_restore(this);
			return result;
		};

		// 3. After a successful save, delete the stored copy.
		const orig_save = P.save;
		P.save = function (save_action, callback, btn, on_error) {
			const key_before_save = is_enabled_for(this) ? draft_key(this) : null;
			const wrapped = function () {
				if (key_before_save) remove_draft(key_before_save);
				if (callback) return callback.apply(this, arguments);
			};
			return orig_save.call(this, save_action, wrapped, btn, on_error);
		};

		// 4. Remember that the user really typed something in the form.
		$(document).on("input change keydown", ".form-layout", function () {
			if (window.cur_frm) window.cur_frm.__bw_user_touched = true;
		});

		// 5. Store immediately when the tab is hidden or closed.
		document.addEventListener("visibilitychange", function () {
			if (document.visibilityState === "hidden") flush();
		});
		window.addEventListener("pagehide", flush);

		purge_expired();
	}

	if (frappe.ui && frappe.ui.form && frappe.ui.form.Form) {
		install();
	} else {
		$(document).on("startup", install);
	}
})();
