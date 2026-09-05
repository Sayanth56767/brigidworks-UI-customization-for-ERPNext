(function () {
	const SIDEBAR_ID = "bw-activity-sidebar";
	const REFRESH_MS = 30000; // re-fetch every 30s
	let refreshTimer = null;

	const ICONS = {
		"Created": "➕",
		"Updated": "➕",
		"Viewed": "➕",
		"Report Run": "➕",
		"Deleted": "➕",
	};

	function buildSidebar() {
		if (document.getElementById(SIDEBAR_ID)) return;

		const sidebar = document.createElement("div");
		sidebar.id = SIDEBAR_ID;
		sidebar.innerHTML = `
			<div class="bw-activity-header">Recent History</div>
			<div class="bw-activity-list"></div>
		`;
		document.body.appendChild(sidebar);
		injectStyles();
	}

	function injectStyles() {
		if (document.getElementById("bw-activity-sidebar-styles")) return;
		const style = document.createElement("style");
		style.id = "bw-activity-sidebar-styles";
		style.textContent = `
			#${SIDEBAR_ID} {
				position: fixed;
				top: var(--navbar-height, 50px);
				right: 0;
				width: 280px;
				height: calc(100vh - var(--navbar-height, 50px));
				background: var(--card-bg, #fff);
				border-left: 1px solid var(--border-color, #d1d8dd);
				overflow-y: auto;
				z-index: 2;
				padding: 12px;
				box-sizing: border-box;
				font-size: 12px;
			}
			.bw-activity-header {
				font-weight: 600;
				font-size: 16px;
				margin-bottom: 12px;
			}
			.bw-activity-row {
				display: flex;
				gap: 8px;
				padding: 8px 4px;
				border-bottom: 1px solid var(--border-color, #eee);
				cursor: pointer;
			}
			.bw-activity-row:hover {
				background: var(--fg-hover-color, #f5f5f5);
			}
			.bw-activity-icon {
				font-size: 16px;
				flex-shrink: 0;
			}
			.bw-activity-subject {
				font-weight: 500;
				line-height: 1.3;
			}
			.bw-activity-time {
				color: var(--text-muted, #888);
				font-size: 11px;
				margin-top: 2px;
			}
			.bw-activity-empty {
				color: var(--text-muted, #888);
				padding: 8px 4px;
			}
		`;
		document.head.appendChild(style);
	}

	function renderRows(rows) {
		const list = document.querySelector(`#${SIDEBAR_ID} .bw-activity-list`);
		if (!list) return;

		if (!rows || !rows.length) {
			list.innerHTML = `<div class="bw-activity-empty">No recent activity</div>`;
			return;
		}

		list.innerHTML = rows.map(row => `
			<div class="bw-activity-row" data-route="${row.route || ''}">
				<div class="bw-activity-icon">${ICONS[row.action] || "•"}</div>
				<div>
					<div class="bw-activity-subject">${frappe.utils.escape_html(row.subject || "")}</div>
					<div class="bw-activity-time">${frappe.utils.escape_html(row.time_ago || "")}</div>
				</div>
			</div>
		`).join("");

		list.querySelectorAll(".bw-activity-row").forEach(el => {
			el.addEventListener("click", () => {
				const route = el.getAttribute("data-route");
				if (route) frappe.set_route(route.replace(/^\/app\//, ""));
			});
		});
	}

	function fetchAndRender() {
		frappe.call({
			method: "brigidworks.activity_api.get_recent_activity",
			args: { limit: 20 },
			callback: function (r) {
				renderRows(r.message);
			},
		});
	}

	function maybeLogView() {
		const route = frappe.get_route();
		// Only log when the user is on an actual document Form view —
		// not a List, Report, or anything else.
		if (!route || route[0] !== "Form" || !route[1] || !route[2]) return;

		const doctype = route[1];
		const docname = route[2];
		// Unsaved new documents get names like "new-customer-1" — that's
		// not a real record being viewed, so skip it.
		if (docname.startsWith("new-")) return;

		frappe.call({
			method: "brigidworks.activity_api.log_view",
			args: { reference_doctype: doctype, reference_name: docname },
			callback: function () {
				fetchAndRender();
			},
		});
	}

	function init() {
		buildSidebar();
		fetchAndRender();
		maybeLogView();
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = setInterval(fetchAndRender, REFRESH_MS);
	}

	frappe.after_ajax(function () {
		init();
	});

	$(document).on("app_ready", init);
	frappe.router.on("change", function () {
		fetchAndRender();
		maybeLogView();
	});
})();
