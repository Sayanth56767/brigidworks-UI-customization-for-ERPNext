frappe.pages["bw-customization-transfer"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Customization Transfer"),
		single_column: true,
	});
	new BWCustomizationTransfer(page);
};

class BWCustomizationTransfer {
	constructor(page) {
		this.page = page;
		this.file_text = null;
		this.dry_run_done = false;
		this.build();
		this.load_counts();
	}

	build() {
		this.$body = $(this.page.main);
		this.$body.html(`
			<div style="max-width: 900px; padding: 15px 0;">

				<div class="frappe-card" style="padding: 20px; margin-bottom: 20px;">
					<h4>1. Export from this site</h4>
					<p class="text-muted">
						Tick what you want to export. Only CUSTOM records are exported
						(not the standard ones that ship with ERPNext). Helper records
						(Roles, Workflow States, Workflow Actions) are added automatically.
					</p>
					<div class="bw-ct-types"><span class="text-muted">Loading counts...</span></div>
					<div style="margin-top: 14px;">
						<button class="btn btn-default btn-xs bw-ct-toggle-all">Select / unselect all</button>
						<button class="btn btn-primary btn-sm bw-ct-export" style="margin-left: 8px;">Export selected</button>
					</div>
				</div>

				<div class="frappe-card" style="padding: 20px; margin-bottom: 20px;">
					<h4>2. Import into this site</h4>
					<p class="text-muted">
						Choose a .json file exported with this tool. Always run
						<b>Preview (dry run)</b> first: it shows what would happen and changes nothing.
					</p>
					<div style="margin-bottom: 12px;">
						<input type="file" accept=".json,application/json" class="bw-ct-file">
					</div>
					<div class="bw-ct-fileinfo text-muted" style="margin-bottom: 12px;"></div>
					<div style="margin-bottom: 12px;">
						<label style="font-weight: 600;">Mode</label>
						<select class="form-control bw-ct-mode" style="max-width: 320px;">
							<option value="Skip existing">Skip existing (safe)</option>
							<option value="Overwrite existing">Overwrite existing (DESTRUCTIVE)</option>
						</select>
						<div class="text-muted small" style="margin-top: 4px;">
							Skip: records that already exist are left untouched.
							Overwrite: existing records are replaced by the file's version.
						</div>
					</div>
					<button class="btn btn-default btn-sm bw-ct-dry" disabled>Preview (dry run)</button>
					<button class="btn btn-danger btn-sm bw-ct-import" style="margin-left: 8px;" disabled>Import now</button>
				</div>

				<div class="bw-ct-result"></div>
			</div>
		`);

		this.$body.on("click", ".bw-ct-toggle-all", () => this.toggle_all());
		this.$body.on("click", ".bw-ct-export", () => this.do_export());
		this.$body.on("change", ".bw-ct-file", (e) => this.on_file(e));
		this.$body.on("change", ".bw-ct-mode", () => this.reset_dry_run());
		this.$body.on("click", ".bw-ct-dry", () => this.call_import(1));
		this.$body.on("click", ".bw-ct-import", () => this.do_import());
	}

	// ---------- Export ----------

	load_counts() {
		frappe.call({
			method: "brigidworks.customization_transfer.get_exportable_counts",
			callback: (r) => {
				const counts = r.message || {};
				let html = "";
				Object.keys(counts).forEach((dt) => {
					html += `
						<div style="margin-bottom: 4px;">
							<label style="font-weight: normal; cursor: pointer;">
								<input type="checkbox" class="bw-ct-type" value="${frappe.utils.escape_html(dt)}" checked>
								${frappe.utils.escape_html(dt)}
								<span class="text-muted">(${counts[dt]})</span>
							</label>
						</div>`;
				});
				this.$body.find(".bw-ct-types").html(html);
			},
		});
	}

	toggle_all() {
		const $boxes = this.$body.find(".bw-ct-type");
		const any_checked = $boxes.filter(":checked").length > 0;
		$boxes.prop("checked", !any_checked);
	}

	do_export() {
		const selected = this.$body
			.find(".bw-ct-type:checked")
			.map(function () { return this.value; })
			.get();

		if (!selected.length) {
			frappe.msgprint(__("Tick at least one type to export."));
			return;
		}

		frappe.call({
			method: "brigidworks.customization_transfer.export_customizations",
			args: { doctypes: JSON.stringify(selected) },
			freeze: true,
			freeze_message: __("Building export file..."),
			callback: (r) => {
				if (!r.message) return;
				this.download_json(r.message);
				const counts = r.message.meta.counts || {};
				const lines = Object.keys(counts).map((k) => `${k}: ${counts[k]}`).join("<br>");
				frappe.msgprint({
					title: __("Export downloaded"),
					message: lines || __("The file is empty: no custom records of the chosen types exist."),
				});
			},
		});
	}

	download_json(data) {
		const stamp = frappe.datetime.now_datetime().replace(/[: ]/g, "-");
		const filename = `brigidworks_customizations_${window.location.hostname}_${stamp}.json`;
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	// ---------- Import ----------

	mode() {
		return this.$body.find(".bw-ct-mode").val();
	}

	reset_dry_run() {
		this.dry_run_done = false;
		this.update_buttons();
	}

	update_buttons() {
		this.$body.find(".bw-ct-dry").prop("disabled", !this.file_text);
		this.$body.find(".bw-ct-import").prop("disabled", !(this.file_text && this.dry_run_done));
	}

	on_file(e) {
		const file = e.target.files[0];
		this.file_text = null;
		this.dry_run_done = false;
		this.$body.find(".bw-ct-result").empty();
		this.$body.find(".bw-ct-fileinfo").empty();
		this.update_buttons();
		if (!file) return;

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const parsed = JSON.parse(reader.result);
				if (!parsed.records) throw new Error("no 'records' key");
				this.file_text = reader.result;
				const meta = parsed.meta || {};
				const counts = meta.counts || {};
				const summary = Object.keys(counts).map((k) => `${k}: ${counts[k]}`).join(" &nbsp;|&nbsp; ");
				this.$body.find(".bw-ct-fileinfo").html(
					`<b>File OK.</b> Exported from: ${frappe.utils.escape_html(meta.source_site || "unknown")}
					 on ${frappe.utils.escape_html(meta.exported_on || "unknown")}<br>${summary}`
				);
			} catch (err) {
				frappe.msgprint(__("That file is not a valid customization export: {0}", [err.message]));
				this.file_text = null;
			}
			this.update_buttons();
		};
		reader.readAsText(file);
	}

	do_import() {
		const run = () => this.call_import(0);
		if (this.mode() === "Overwrite existing") {
			frappe.confirm(
				__("Overwrite mode REPLACES existing records with the versions in the file. This cannot be undone. Continue?"),
				run
			);
		} else {
			run();
		}
	}

	call_import(dry_run) {
		if (!this.file_text) return;
		frappe.call({
			method: "brigidworks.customization_transfer.import_customizations",
			args: { payload: this.file_text, mode: this.mode(), dry_run: dry_run },
			freeze: true,
			freeze_message: dry_run ? __("Running preview...") : __("Importing...Do not close this tab."),
			callback: (r) => {
				if (!r.message) return;
				this.render_result(r.message);
				if (dry_run) {
					this.dry_run_done = true;
					this.update_buttons();
				}
			},
		});
	}

	render_result(res) {
		const s = res.summary;
		const colors = { created: "green", updated: "orange", skipped: "gray", failed: "red" };
		const title = res.dry_run
			? "PREVIEW ONLY - nothing was changed"
			: "IMPORT FINISHED";

		let rows = "";
		res.details.forEach((d) => {
			rows += `
				<tr>
					<td>${frappe.utils.escape_html(d[0])}</td>
					<td>${frappe.utils.escape_html(d[1])}</td>
					<td><span class="indicator-pill ${colors[d[2]] || "gray"}">${frappe.utils.escape_html(d[2])}</span></td>
					<td class="text-muted small">${frappe.utils.escape_html(d[3] || "")}</td>
				</tr>`;
		});

		let note = "";
		if (res.dry_run) {
			note = "<p class='text-muted'>A preview cannot catch every problem (for example a missing linked record). Failures, if any, appear only during the real import.</p>";
		} else {
			note = "<p class='text-muted'>Hard-refresh the browser (Ctrl+Shift+R) so new fields and scripts load.</p>";
		}

		this.$body.find(".bw-ct-result").html(`
			<div class="frappe-card" style="padding: 20px; max-width: 900px;">
				<h4>${title}</h4>
				<p>
					<span class="indicator-pill green">created: ${s.created}</span>
					<span class="indicator-pill orange">updated: ${s.updated}</span>
					<span class="indicator-pill gray">skipped: ${s.skipped}</span>
					<span class="indicator-pill red">failed: ${s.failed}</span>
				</p>
				${note}
				<div style="max-height: 420px; overflow: auto;">
					<table class="table table-bordered table-sm">
						<thead><tr><th>Type</th><th>Name</th><th>Result</th><th>Message</th></tr></thead>
						<tbody>${rows}</tbody>
					</table>
				</div>
			</div>
		`);
	}
}
