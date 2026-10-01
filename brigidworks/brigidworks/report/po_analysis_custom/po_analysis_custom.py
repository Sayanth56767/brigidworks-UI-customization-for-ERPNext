# Copyright (c) 2026
# Custom Purchase Order Analysis (Script Report)

import frappe
from frappe import _
from frappe.utils import flt

SUM_FIELDS = [
	"qty",
	"received_qty",
	"pending_qty",
	"amount",
	"gst_amount",
	"total_with_gst",
	"billed_amount",
	"amount_to_bill",
]


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = get_columns(filters)
	data = get_data(filters)
	chart = get_chart(data)
	return columns, data, None, chart


def get_data(filters):
	# Optional custom fields: used only if they exist on Purchase Order Item
	meta = frappe.get_meta("Purchase Order Item")
	extra = ""
	for fieldname, alias in (("custom_remark", "remark"), ("custom_delivery_time", "delivery_time")):
		if meta.has_field(fieldname):
			extra += f", poi.{fieldname} AS {alias}"
		else:
			extra += f", NULL AS {alias}"

	conditions = [
		"po.docstatus = 1",
		"po.company = %(company)s",
		"po.transaction_date BETWEEN %(from_date)s AND %(to_date)s",
	]
	if filters.get("project"):
		conditions.append("poi.project = %(project)s")
	if filters.get("name"):
		conditions.append("po.name = %(name)s")
	if filters.get("status"):
		conditions.append("po.status = %(status)s")

	rows = frappe.db.sql(
		f"""
		SELECT
			po.name AS purchase_order,
			po.transaction_date AS date,
			po.supplier,
			po.supplier_name,
			po.status,
			po.payment_terms_template,
			poi.project,
			poi.item_code,
			poi.item_name,
			poi.item_group,
			poi.description,
			poi.uom,
			poi.qty,
			poi.received_qty,
			poi.rate,
			poi.amount,
			poi.billed_amt AS billed_amount,
			poi.schedule_date,
			IF(po.net_total, po.total_taxes_and_charges * poi.net_amount / po.net_total, 0) AS gst_amount
			{extra}
		FROM `tabPurchase Order` po
		JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
		WHERE {" AND ".join(conditions)}
		ORDER BY po.transaction_date DESC, po.name, poi.idx
		""",
		filters,
		as_dict=1,
	)

	for r in rows:
		r.pending_qty = flt(r.qty) - flt(r.received_qty)
		r.gst_amount = flt(r.gst_amount, 2)
		r.total_with_gst = flt(r.amount) + r.gst_amount
		r.amount_to_bill = flt(r.amount) - flt(r.billed_amount)

	if filters.get("group_by_po"):
		rows = group_by_po(rows)

	return rows


def group_by_po(rows):
	grouped = {}
	for r in rows:
		g = grouped.setdefault(
			r.purchase_order,
			frappe._dict(
				purchase_order=r.purchase_order,
				date=r.date,
				supplier=r.supplier,
				supplier_name=r.supplier_name,
				status=r.status,
				payment_terms_template=r.payment_terms_template,
				project=r.project,
			),
		)
		for f in SUM_FIELDS:
			g[f] = flt(g.get(f)) + flt(r.get(f))
	return list(grouped.values())


def get_chart(data):
	if not data:
		return None
	billed = sum(flt(d.get("billed_amount")) for d in data)
	to_bill = sum(flt(d.get("amount_to_bill")) for d in data)
	return {
		"data": {
			"labels": [_("Amount to Bill"), _("Billed Amount")],
			"datasets": [{"values": [to_bill, billed]}],
		},
		"type": "donut",
		"height": 280,
	}


def get_columns(filters):
	columns = [
		{"label": _("PO Number"), "fieldname": "purchase_order", "fieldtype": "Link", "options": "Purchase Order", "width": 160},
		{"label": _("Order Date"), "fieldname": "date", "fieldtype": "Date", "width": 100},
		{"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 130},
		{"label": _("Vendor Name"), "fieldname": "supplier_name", "fieldtype": "Data", "width": 200},
		{"label": _("Project"), "fieldname": "project", "fieldtype": "Link", "options": "Project", "width": 110},
	]

	if not filters.get("group_by_po"):
		columns += [
			{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 130},
			{"label": _("Material Category"), "fieldname": "item_group", "fieldtype": "Link", "options": "Item Group", "width": 140},
			{"label": _("Description of Goods"), "fieldname": "description", "fieldtype": "Data", "width": 250},
			{"label": _("UOM"), "fieldname": "uom", "fieldtype": "Link", "options": "UOM", "width": 70},
		]

	columns += [
		{"label": _("Quantity"), "fieldname": "qty", "fieldtype": "Float", "width": 90},
		{"label": _("Received Qty"), "fieldname": "received_qty", "fieldtype": "Float", "width": 100},
		{"label": _("Pending Qty"), "fieldname": "pending_qty", "fieldtype": "Float", "width": 100},
	]

	if not filters.get("group_by_po"):
		columns.append({"label": _("Rate"), "fieldname": "rate", "fieldtype": "Currency", "width": 100})

	columns += [
		{"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "width": 110},
		{"label": _("GST Amount"), "fieldname": "gst_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("Total GST Amount"), "fieldname": "total_with_gst", "fieldtype": "Currency", "width": 130},
		{"label": _("Billed Amount"), "fieldname": "billed_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("Amount to Bill"), "fieldname": "amount_to_bill", "fieldtype": "Currency", "width": 110},
		{"label": _("Payment Terms"), "fieldname": "payment_terms_template", "fieldtype": "Link", "options": "Payment Terms Template", "width": 150},
	]

	if not filters.get("group_by_po"):
		columns += [
			{"label": _("Required By"), "fieldname": "schedule_date", "fieldtype": "Date", "width": 100},
			{"label": _("Delivery Time"), "fieldname": "delivery_time", "fieldtype": "Data", "width": 110},
			{"label": _("Remark"), "fieldname": "remark", "fieldtype": "Data", "width": 160},
		]

	return columns
