(function () {
	const SIDEBAR_ID = "bw-activity-sidebar";
	const TOGGLE_ID = "bw-activity-toggle";
	const SIDEBAR_WIDTH = 280;
	const REFRESH_MS = 30000;
	const COLLAPSE_KEY = "bw_activity_sidebar_collapsed";
	const GROUP_COLLAPSE_KEY_PREFIX = "bw_activity_group_collapsed_";
	const TOP_EXTRA_OFFSET = 12;
	let refreshTimer = null;

	// ---------------------------------------------------------------
	// CONFIG: order of the dropdown groups (top to bottom)
	// ---------------------------------------------------------------
	const GROUP_ORDER = ["Viewed", "Updated", "Created", "Report Run", "Deleted"];

	// ---------------------------------------------------------------
	// CONFIG: icon colors — change any hex value here to recolor that
	// icon everywhere (group header and rows). Then rebuild + hard-refresh.
	// ---------------------------------------------------------------
	const ICON_COLORS = {
		"Viewed": "#3b82f6",     // blue
		"Updated": "#f59e0b",    // amber
		"Created": "#22c55e",    // green
		"Report Run": "#8b5cf6", // purple
		"Deleted": "#ef4444",    // red
		"Other": "#6b7280",      // grey fallback
	};

	// ---------------------------------------------------------------
	// Icons: inline SVGs drawn with currentColor, so they take on the
	// color set above. 24x24 viewBox, stroke style.
	// ---------------------------------------------------------------
	const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
	const ICON_PATHS = {
		"Viewed": '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
		"Updated": '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
		"Created": '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
		"Report Run": '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
		"Deleted": '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
		"Other": '<circle cx="12" cy="12" r="3"/>',
	};

	function iconHtml(action) {
		const key = ICON_PATHS[action] ? action : "Other";
		const color = ICON_COLORS[key] || ICON_COLORS["Other"];
		return `<span class="bw-icon" style="color:${color}">${SVG_OPEN}${ICON_PATHS[key]}</svg></span>`;
	}

	function getNavbarHeight() {
		const navbar = document.querySelector(".navbar");
		if (navbar) {
			const h = navbar.getBoundingClientRect().height;
			if (h > 0) return h;
		}
		return 50;
	}

	function buildSidebar() {
		if (document.getElementById(SIDEBAR_ID)) return;

		injectStyles();

		const sidebar = document.createElement("div");
		sidebar.id = SIDEBAR_ID;
		sidebar.innerHTML = `
			<div class="bw-activity-header">Recent History</div>
			<div class="bw-activity-groups"></div>
		`;
		document.body.appendChild(sidebar);

		const toggle = document.createElement("div");
		toggle.id = TOGGLE_ID;
		toggle.title = "Toggle Recent History";
		toggle.textContent = "›";
		document.body.appendChild(toggle);

		wireToggle();
		applyStoredCollapseState();
		positionForNavbar();

		window.addEventListener("resize", positionForNavbar);
	}

	function injectStyles() {
		if (document.getElementById("bw-activity-sidebar-styles")) return;
		const style = document.createElement("style");
		style.id = "bw-activity-sidebar-styles";
		style.textContent = `
			#${SIDEBAR_ID} {
				position: fixed;
				right: 0;
				width: ${SIDEBAR_WIDTH}px;
				background: var(--card-bg, #fff);
				border-left: 1px solid var(--border-color, #d1d8dd);
				overflow-y: auto;
				overflow-x: hidden;
				z-index: 5;
				padding: 12px;
				box-sizing: border-box;
				font-size: 12px;
				transition: right 0.2s ease;
			}
			#${SIDEBAR_ID}.bw-collapsed {
				right: -${SIDEBAR_WIDTH}px;
			}
			#${TOGGLE_ID} {
				position: fixed;
				right: ${SIDEBAR_WIDTH}px;
				width: 22px;
				height: 32px;
				background: var(--card-bg, #fff);
				border: 1px solid var(--border-color, #d1d8dd);
				border-right: none;
				border-radius: 6px 0 0 6px;
				display: flex;
				align-items: center;
				justify-content: center;
				cursor: pointer;
				font-size: 16px;
				user-select: none;
				z-index: 6;
				transition: right 0.2s ease;
			}
			#${TOGGLE_ID}.bw-collapsed {
				right: 0;
			}
			body.modal-open #${SIDEBAR_ID},
			body.modal-open #${TOGGLE_ID} {
				display: none;
			}
			body.modal-open {
				margin-right: 0 !important;
			}
			.bw-activity-header {
				font-weight: 600;
				font-size: 16px;
				margin-bottom: 12px;
			}
			.bw-icon {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				flex-shrink: 0;
			}
			.bw-icon svg {
				width: 16px;
				height: 16px;
				display: block;
			}
			.bw-group {
				margin-bottom: 6px;
			}
			.bw-group-header {
				display: flex;
				align-items: center;
				gap: 6px;
				padding: 6px 4px;
				cursor: pointer;
				font-weight: 600;
				border-bottom: 1px solid var(--border-color, #eee);
				user-select: none;
			}
			.bw-group-header:hover {
				background: var(--fg-hover-color, #f5f5f5);
			}
			.bw-group-title {
				display: flex;
				align-items: center;
				gap: 6px;
			}
			.bw-group-chevron {
				transition: transform 0.15s ease;
				font-size: 10px;
				flex-shrink: 0;
			}
			.bw-group.bw-group-collapsed .bw-group-chevron {
				transform: rotate(-90deg);
			}
			.bw-group-count {
				color: var(--text-muted, #888);
				font-weight: 400;
				margin-left: auto;
			}
			.bw-group-rows {
				overflow: hidden;
			}
			.bw-group.bw-group-collapsed .bw-group-rows {
				display: none;
			}
			.bw-activity-row {
				display: flex;
				gap: 8px;
				padding: 8px 4px 8px 20px;
				border-bottom: 1px solid var(--border-color, #eee);
				cursor: pointer;
			}
			.bw-activity-row:hover {
				background: var(--fg-hover-color, #f5f5f5);
			}
			.bw-activity-row .bw-icon {
				margin-top: 1px;
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

	function positionForNavbar() {
		const navHeight = getNavbarHeight() + TOP_EXTRA_OFFSET;
		const sidebar = document.getElementById(SIDEBAR_ID);
		const toggle = document.getElementById(TOGGLE_ID);
		if (!sidebar || !toggle) return;

		sidebar.style.top = navHeight + "px";
		sidebar.style.height = `calc(100vh - ${navHeight}px)`;
		toggle.style.top = navHeight + "px";

		const isCollapsed = sidebar.classList.contains("bw-collapsed");
		applyBodyMargin(isCollapsed);
	}

	function applyBodyMargin(collapsed) {
		document.body.style.transition = "margin-right 0.2s ease";
		document.body.style.marginRight = collapsed ? "0" : SIDEBAR_WIDTH + "px";
	}

	function wireToggle() {
		const toggle = document.getElementById(TOGGLE_ID);
		const sidebar = document.getElementById(SIDEBAR_ID);
		if (!toggle || !sidebar) return;

		toggle.addEventListener("click", () => {
			const collapsed = sidebar.classList.toggle("bw-collapsed");
			toggle.classList.toggle("bw-collapsed", collapsed);
			toggle.textContent = collapsed ? "‹" : "›";
			applyBodyMargin(collapsed);
			try {
				localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
			} catch (e) {
				// ignore
			}
		});
	}

	function applyStoredCollapseState() {
		let collapsed = false;
		try {
			collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
		} catch (e) {
			// default to expanded
		}
		const sidebar = document.getElementById(SIDEBAR_ID);
		const toggle = document.getElementById(TOGGLE_ID);
		if (collapsed && sidebar && toggle) {
			sidebar.classList.add("bw-collapsed");
			toggle.classList.add("bw-collapsed");
			toggle.textContent = "‹";
		}
	}

	function isGroupCollapsed(action) {
		try {
			return localStorage.getItem(GROUP_COLLAPSE_KEY_PREFIX + action) === "1";
		} catch (e) {
			return false;
		}
	}

	function setGroupCollapsed(action, collapsed) {
		try {
			localStorage.setItem(GROUP_COLLAPSE_KEY_PREFIX + action, collapsed ? "1" : "0");
		} catch (e) {
			// ignore
		}
	}

	function renderRows(rows) {
		const container = document.querySelector(`#${SIDEBAR_ID} .bw-activity-groups`);
		if (!container) return;

		if (!rows || !rows.length) {
			container.innerHTML = `<div class="bw-activity-empty">No recent activity</div>`;
			return;
		}

		const groups = {};
		rows.forEach(row => {
			const action = row.action || "Other";
			if (!groups[action]) groups[action] = [];
			groups[action].push(row);
		});

		const orderedActions = GROUP_ORDER.filter(a => groups[a] && groups[a].length)
			.concat(Object.keys(groups).filter(a => !GROUP_ORDER.includes(a)));

		container.innerHTML = orderedActions.map(action => {
			const groupRows = groups[action];
			const collapsed = isGroupCollapsed(action);
			const rowsHtml = groupRows.map(row => `
				<div class="bw-activity-row" data-route="${row.route || ''}">
					${iconHtml(action)}
					<div>
						<div class="bw-activity-subject">${frappe.utils.escape_html(row.subject || "")}</div>
						<div class="bw-activity-time">${frappe.utils.escape_html(row.time_ago || "")}</div>
					</div>
				</div>
			`).join("");

			return `
				<div class="bw-group ${collapsed ? "bw-group-collapsed" : ""}" data-action="${frappe.utils.escape_html(action)}">
					<div class="bw-group-header">
						<span class="bw-group-chevron">▾</span>
						<span class="bw-group-title">${iconHtml(action)}<span>${frappe.utils.escape_html(action)}</span></span>
						<span class="bw-group-count">${groupRows.length}</span>
					</div>
					<div class="bw-group-rows">${rowsHtml}</div>
				</div>
			`;
		}).join("");

		container.querySelectorAll(".bw-group-header").forEach(header => {
			header.addEventListener("click", () => {
				const group = header.closest(".bw-group");
				const action = group.getAttribute("data-action");
				const collapsed = group.classList.toggle("bw-group-collapsed");
				setGroupCollapsed(action, collapsed);
			});
		});

		container.querySelectorAll(".bw-activity-row").forEach(el => {
			el.addEventListener("click", (e) => {
				e.stopPropagation();
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
		if (!route || route[0] !== "Form" || !route[1] || !route[2]) return;

		const doctype = route[1];
		const docname = route[2];
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
		refreshTimer = setInterval(function () {
			fetchAndRender();
			positionForNavbar();
		}, REFRESH_MS);
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
