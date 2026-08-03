frappe.pages['brigidworks-clone-tool'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Brigidworks Clone Tool',
		single_column: true
	});

	$(wrapper).find('.layout-main-section').html(`
		<div class="brigidworks-clone-tool">
			<h4>Export Customizations</h4>
			<div id="customization-checkboxes"></div>

			<h4 style="margin-top: 25px;">Export Data (actual records)</h4>
			<p class="text-muted">Search for a doctype and add it. Linked doctypes will be auto-suggested.</p>
			<input type="text" id="doctype-search" class="form-control" placeholder="Search doctypes..." style="max-width: 400px;">
			<div id="doctype-search-results" style="max-width: 400px; border: 1px solid #d1d8dd; max-height: 150px; overflow-y: auto; display: none;"></div>
			<div id="selected-data-doctypes" style="margin-top: 10px;"></div>

			<button class="btn btn-primary btn-sm" id="export-btn" style="margin-top: 20px;">Export Bundle</button>

			<hr style="margin: 30px 0;">

			<h4>Import</h4>
			<p class="text-muted">Upload a bundle exported from another site.</p>
			<input type="file" id="import-file-input" accept=".json" style="margin-bottom: 15px;">
			<div id="import-preview"></div>
		</div>
	`);

	// ---------- CUSTOMIZATIONS CHECKBOXES ----------
	var customization_types = [
		{ key: "client_script", label: "Client Scripts" },
		{ key: "server_script", label: "Server Scripts" },
		{ key: "custom_field", label: "Custom Fields" },
		{ key: "property_setter", label: "Customizations to Doctypes/Forms" },
		{ key: "workflow", label: "Workflows" },
		{ key: "custom_doctype", label: "Custom DocTypes" }
	];
	var checkbox_html = "";
	customization_types.forEach(function(item) {
		checkbox_html += `
			<div class="checkbox">
				<label><input type="checkbox" class="customization-checkbox" value="${item.key}" checked> ${item.label}</label>
			</div>`;
	});
	$(wrapper).find('#customization-checkboxes').html(checkbox_html);

	// ---------- DATA SECTION: doctype search + selection ----------
	var all_doctypes = [];
	var selected_data_doctypes = {}; // { "Customer": {auto: false}, "Company": {auto: true, via: "Customer"} }

	frappe.call({
		method: "brigidworks.brigidworks.api.get_exportable_doctypes",
		callback: function(r) {
			all_doctypes = r.message || [];
		}
	});

	$(wrapper).find('#doctype-search').on('input', function() {
		var term = $(this).val().toLowerCase();
		var results_box = $(wrapper).find('#doctype-search-results');
		if (!term) {
			results_box.hide().empty();
			return;
		}
		var matches = all_doctypes.filter(function(d) {
			return d.name.toLowerCase().includes(term);
		}).slice(0, 20);

		if (matches.length === 0) {
			results_box.hide().empty();
			return;
		}

		var html = "";
		matches.forEach(function(d) {
			html += `<div class="doctype-result" data-doctype="${d.name}" style="padding: 6px 10px; cursor: pointer; border-bottom: 1px solid #eee;">${d.name} <span class="text-muted">(${d.module})</span></div>`;
		});
		results_box.html(html).show();
	});

	$(wrapper).on('click', '.doctype-result', function() {
		var doctype = $(this).data('doctype');
		add_data_doctype(doctype, false, null);
		$(wrapper).find('#doctype-search').val('');
		$(wrapper).find('#doctype-search-results').hide().empty();
	});

	function add_data_doctype(doctype, is_auto, via) {
		if (selected_data_doctypes[doctype]) return; // already added
		selected_data_doctypes[doctype] = { auto: is_auto, via: via };
		render_selected_doctypes();

		if (!is_auto) {
			// look up what this doctype links to, and suggest those too
			frappe.call({
				method: "brigidworks.brigidworks.api.get_linked_doctypes",
				args: { doctype: doctype },
				callback: function(r) {
					(r.message || []).forEach(function(linked_dt) {
						if (!selected_data_doctypes[linked_dt]) {
							add_data_doctype(linked_dt, true, doctype);
						}
					});
				}
			});
		}
	}

	function render_selected_doctypes() {
		var container = $(wrapper).find('#selected-data-doctypes');
		var keys = Object.keys(selected_data_doctypes);
		if (keys.length === 0) {
			container.html('<p class="text-muted">No data doctypes selected yet.</p>');
			return;
		}
		var html = "";
		keys.forEach(function(dt) {
			var info = selected_data_doctypes[dt];
			var badge = info.auto ? ` <span class="text-muted" style="font-size: 11px;">(auto - linked from ${info.via})</span>` : "";
			var count_span = `<span class="record-count" data-doctype="${dt}" style="font-weight: bold;">...</span>`;
			html += `
				<span class="label label-default" style="display: inline-block; margin: 3px; padding: 5px 8px;">
					${dt} (${count_span} records)${badge}
					<a href="#" class="remove-data-doctype" data-doctype="${dt}" style="margin-left: 6px; color: #d33;">&times;</a>
				</span>`;
		});
		container.html(html);

		// fetch counts after render, fill them in as they arrive
		keys.forEach(function(dt) {
			frappe.call({
				method: "brigidworks.brigidworks.api.get_doctype_record_count",
				args: { doctype: dt },
				callback: function(r) {
					var count = r.message;
					var el = container.find('.record-count[data-doctype="' + dt + '"]');
					el.text(count);
					if (count > 50) {
						el.css('color', '#d33'); // flag large counts in red - likely reference/master data, not "your" data
					} else {
						el.css('color', '#2e7d32');
					}
				}
			});
		});
	}

	$(wrapper).on('click', '.remove-data-doctype', function(e) {
		e.preventDefault();
		delete selected_data_doctypes[$(this).data('doctype')];
		render_selected_doctypes();
	});

	// ---------- EXPORT (now combines Customizations + Data into one bundle) ----------
	$(wrapper).find('#export-btn').on('click', function() {
		var selected_customizations = [];
		$(wrapper).find('.customization-checkbox:checked').each(function() {
			selected_customizations.push($(this).val());
		});
		var data_doctypes = Object.keys(selected_data_doctypes);

		if (selected_customizations.length === 0 && data_doctypes.length === 0) {
			frappe.msgprint("Please select at least one item to export.");
			return;
		}

		frappe.show_alert({ message: "Preparing export...", indicator: "blue" });

		var combined_bundle = null;

		function download_bundle() {
			var bundle_str = JSON.stringify(combined_bundle, null, 2);
			var blob = new Blob([bundle_str], { type: "application/json" });
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			var filename = "brigidworks_export_" + frappe.datetime.now_datetime().replace(/[: ]/g, "_") + ".json";
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			frappe.show_alert({ message: "Export downloaded!", indicator: "green" });
		}

		function merge_into_combined(result) {
			if (!combined_bundle) {
				combined_bundle = result;
			} else {
				Object.keys(result.data).forEach(function(dt) {
					combined_bundle.data[dt] = (combined_bundle.data[dt] || []).concat(result.data[dt]);
				});
			}
		}

		var calls_remaining = 0;
		if (selected_customizations.length > 0) calls_remaining++;
		if (data_doctypes.length > 0) calls_remaining++;

		function call_done() {
			calls_remaining--;
			if (calls_remaining === 0) download_bundle();
		}

		if (selected_customizations.length > 0) {
			frappe.call({
				method: "brigidworks.brigidworks.api.export_customizations",
				args: { selections: selected_customizations },
				callback: function(r) { merge_into_combined(r.message); call_done(); }
			});
		}
		if (data_doctypes.length > 0) {
			frappe.call({
				method: "brigidworks.brigidworks.api.export_data",
				args: { doctypes: data_doctypes },
				callback: function(r) { merge_into_combined(r.message); call_done(); }
			});
		}
	});

	// ---------- IMPORT (unchanged from before - already generic) ----------
	var loaded_bundle = null;

	$(wrapper).find('#import-file-input').on('change', function(e) {
		var file = e.target.files[0];
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function(event) {
			try {
				loaded_bundle = JSON.parse(event.target.result);
			} catch (err) {
				frappe.msgprint("This doesn't look like a valid JSON file.");
				loaded_bundle = null;
				return;
			}
			render_import_preview();
		};
		reader.readAsText(file);
	});

	function render_import_preview() {
		var data = (loaded_bundle && loaded_bundle.data) || {};
		var doctypes = Object.keys(data).filter(function(dt) { return data[dt] && data[dt].length > 0; });

		if (doctypes.length === 0) {
			$(wrapper).find('#import-preview').html('<p class="text-muted">This bundle has nothing importable in it.</p>');
			return;
		}

		var preview_html = '<p><strong>Source site:</strong> ' + (loaded_bundle.source_site || 'unknown') + '</p><p><strong>Found:</strong></p>';
		doctypes.forEach(function(dt) {
			preview_html += `
				<div class="checkbox">
					<label><input type="checkbox" class="import-doctype-checkbox" value="${dt}" checked> ${dt} (${data[dt].length} record${data[dt].length === 1 ? '' : 's'})</label>
				</div>`;
		});

		preview_html += `
			<div style="margin-top: 15px;">
				<label><strong>If a record already exists on this site:</strong></label><br>
				<label style="margin-right: 15px;"><input type="radio" name="import-mode" value="skip" checked> Skip it (safe, default)</label>
				<label><input type="radio" name="import-mode" value="overwrite"> Overwrite it</label>
			</div>
			<p class="text-muted" style="margin-top: 5px; font-size: 12px;">
				Warning: Overwriting an existing Custom DocType deletes and recreates its table - this destroys any real records already stored under that doctype on this site.
			</p>
			<button class="btn btn-primary btn-sm" id="import-btn" style="margin-top: 10px;">Import Selected</button>
			<div id="import-results" style="margin-top: 15px;"></div>
		`;
		$(wrapper).find('#import-preview').html(preview_html);

		$(wrapper).find('#import-btn').on('click', function() {
			var selected = [];
			$(wrapper).find('.import-doctype-checkbox:checked').each(function() { selected.push($(this).val()); });
			var mode = $(wrapper).find('input[name="import-mode"]:checked').val();

			if (selected.length === 0) {
				frappe.msgprint("Please select at least one item to import.");
				return;
			}

			frappe.confirm('Import ' + selected.length + ' item type(s) with mode "' + mode + '"?', function() {
				frappe.show_alert({ message: "Importing...", indicator: "blue" });
				frappe.call({
					method: "brigidworks.brigidworks.api.import_customizations",
					args: { bundle: loaded_bundle, selections: selected, mode: mode },
					callback: function(r) {
						if (!r.message) { frappe.msgprint("Import failed - no result returned."); return; }
						var res = r.message;
						var summary = `
							<p><strong>Created:</strong> ${res.created.length}</p>
							<p><strong>Overwritten:</strong> ${res.overwritten.length}</p>
							<p><strong>Skipped (already existed):</strong> ${res.skipped.length}</p>
							<p><strong>Errors:</strong> ${res.errors.length}</p>`;
						if (res.errors.length > 0) summary += '<p class="text-danger">' + res.errors.join('<br>') + '</p>';
						$(wrapper).find('#import-results').html(summary);
						frappe.show_alert({ message: "Import finished!", indicator: "green" });
					}
				});
			});
		});
	}
};
