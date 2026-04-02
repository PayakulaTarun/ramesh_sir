#!/usr/bin/env python3
import os, sys, json, datetime, shutil, traceback
from pathlib import Path
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

APP_DIR = Path(__file__).parent.resolve()
INPUT_DB = APP_DIR / 'ubpl_Database.xlsx'
if os.environ.get('VERCEL') == '1':
    OUTPUT_DB = Path('/tmp/ubpl_Dashboard_Output.xlsx')
else:
    OUTPUT_DB = APP_DIR / 'ubpl_Dashboard_Output.xlsx'

STATUSES = ['AFC','IFC','IFA','IFR','IDC','DUE']
STATUS_WEIGHTS = {'DUE':0,'IDC':0.15,'IFR':0.4,'IFA':0.65,'IFC':0.8,'AFC':0.95}

app = Flask(__name__)
CORS(app)

# ── Dynamic Helpers ──
def get_ox():
    import openpyxl
    return openpyxl

def get_supabase():
    try:
        from supabase import create_client
        url = os.environ.get('SUPABASE_URL', 'https://xsdeayissiufzszkyels.supabase.co')
        key = os.environ.get('SUPABASE_SERVICE_KEY')
        if key: return create_client(url, key)
    except: pass
    return None

@app.before_request
def ensure_setup():
    if not OUTPUT_DB.exists() and INPUT_DB.exists():
        try: shutil.copy2(str(INPUT_DB), str(OUTPUT_DB))
        except: pass

@app.errorhandler(Exception)
def handle_err(e):
    return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500

# ── Business Logic ──
def read_summary():
    ox = get_ox(); wb = ox.load_workbook(str(OUTPUT_DB), data_only=True)
    if 'Summary' not in wb.sheetnames: return []
    ws = wb['Summary']; data = []; headers = [str(c.value).strip() if c.value else "" for c in ws[1]]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0] or str(row[0]) == 'TOTAL': continue
        d = {headers[i]: v for i, v in enumerate(row) if i < len(headers)}
        res = {'name': str(d.get('Discipline', '')), 'AFC': int(d.get('AFC', 0) or 0), 'IFC': int(d.get('IFC', 0) or 0), 'IFA': int(d.get('IFA', 0) or 0), 'IFR': int(d.get('IFR', 0) or 0), 'IDC': int(d.get('IDC', 0) or 0), 'DUE': int(d.get('DUE', 0) or 0), 'plannedWtg': float(d.get('PlannedWtg', 0) or 0), 'earnedWtg': float(d.get('EarnedWtg', 0) or 0)}
        res['total'] = sum(res[s] for s in STATUSES); res['completionPct'] = (res['earnedWtg']/res['plannedWtg']*100) if res['plannedWtg']>0 else 0
        data.append(res)
    return data

def read_dci():
    ox = get_ox(); wb = ox.load_workbook(str(OUTPUT_DB), data_only=True)
    if 'DCI' not in wb.sheetnames: return []
    ws = wb['DCI']; data = []; headers = [str(c.value).strip() if c.value else "" for c in ws[1]]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not any(r): continue
        d = {headers[i]: v for i, v in enumerate(r) if i < len(headers)}
        data.append({'discipline':str(d.get('Discipline','')),'docNum':str(d.get('DocNum','')),'docDesc':str(d.get('DocDesc','')),'subFormat':str(d.get('SubFormat','')),'approvalCat':str(d.get('ApprovalCat','')),'weitage':float(d.get('Weitage',0) or 0),'initSchedule':str(d.get('InitSchedule','') or '')[:10],'latestRev':str(d.get('LatestRev','') or ''),'latestStatus':str(d.get('LatestStatus','') or 'DUE'),'pctWeitage':float(d.get('PctWeitage',0) or 0),'remarks':str(d.get('Remarks','') or '')})
    return data

def update_status(doc_num, new_status, new_rev=''):
    ox = get_ox(); wb = ox.load_workbook(str(OUTPUT_DB)); ws = wb['DCI']
    for r in range(2, ws.max_row+1):
        if str(ws.cell(row=r, column=2).value) == str(doc_num):
            ws.cell(row=r, column=9, value=new_status)
            if new_rev: ws.cell(row=r, column=8, value=new_rev)
            wt = float(ws.cell(row=r, column=6).value or 0)
            ws.cell(row=r, column=10, value=wt * STATUS_WEIGHTS.get(new_status, 0))
            wb.save(str(OUTPUT_DB)); rebuild_summary(); return True
    return False

def rebuild_summary():
    ox = get_ox(); wb = ox.load_workbook(str(OUTPUT_DB)); ws_dci = wb['DCI']; stats = {}
    for r in ws_dci.iter_rows(min_row=2, values_only=True):
        disc, status, pct_wt = str(r[0]), str(r[8]), float(r[9] or 0)
        if disc not in stats: stats[disc] = {s: 0 for s in STATUSES}; stats[disc]['earned'] = 0.0
        if status in STATUSES: stats[disc][status] += 1
        stats[disc]['earned'] += pct_wt
    ws_sum = wb['Summary']
    for r in range(2, ws_sum.max_row+1):
        disc = ws_sum.cell(row=r, column=1).value
        if disc in stats:
            for si, s in enumerate(STATUSES): ws_sum.cell(row=r, column=si+2, value=stats[disc][s])
            ws_sum.cell(row=r, column=10, value=round(stats[disc]['earned'], 6))
    wb.save(str(OUTPUT_DB))

def read_snapshots():
    try:
        ox = get_ox(); wb = ox.load_workbook(str(OUTPUT_DB), data_only=True)
        if 'Snapshots' not in wb.sheetnames: return []
        rows = list(wb['Snapshots'].iter_rows(min_row=2, values_only=True)); snaps = {}
        for r in rows:
            if not r or not r[0]: continue
            key = str(r[0])
            if key not in snaps: snaps[key] = {'date': key, 'week': int(r[1] or 0), 'year': int(r[2] or 0), 'disciplines': []}
            snaps[key]['disciplines'].append({'name':str(r[3]), 'AFC':int(r[4] or 0), 'IFC':int(r[5] or 0), 'IFA':int(r[6] or 0), 'IFR':int(r[7] or 0), 'IDC':int(r[8] or 0), 'DUE':int(r[9] or 0), 'total':int(r[10] or 0), 'plannedWtg':float(r[11] or 0), 'earnedWtg':float(r[12] or 0), 'completionPct':float(r[13] or 0)})
        
        snap_list = []
        for k in sorted(snaps.keys(), reverse=True):
            s = snaps[k]; t = {'docs': 0, 'wt': 0, 'ew': 0, 'status': {st: 0 for st in STATUSES}}
            for d in s['disciplines']:
                t['docs'] += d['total']; t['wt'] += d['plannedWtg']; t['ew'] += d['earnedWtg']
                for st in STATUSES: t['status'][st] += d[st]
            t['pct'] = (t['ew'] / t['wt'] * 100) if t['wt'] > 0 else 0
            t['approved'] = t['status']['AFC'] + t['status']['IFC']
            t['pending'] = t['status']['DUE']
            s['totals'] = t; snap_list.append(s)
        return snap_list
    except: return []

# ── Routes ──
@app.route('/api/summary')
def api_sum(): return jsonify(read_summary())
@app.route('/api/config')
def api_conf():
    ox = get_ox(); wb = ox.load_workbook(str(OUTPUT_DB), data_only=True)
    if 'Config' not in wb.sheetnames: return jsonify({})
    return jsonify({str(r[0]): str(r[1]) for r in wb['Config'].iter_rows(min_row=2, values_only=True) if r[0]})
@app.route('/api/snapshots')
def api_snapshots(): return jsonify(read_snapshots())
@app.route('/api/dci')
def api_dci_route():
    data = read_dci(); disc = request.args.get('discipline'); st = request.args.get('status')
    if disc: data = [d for d in data if d['discipline'] == disc]
    if st: data = [d for d in data if d['latestStatus'] == st]
    return jsonify(data)
@app.route('/api/update_status', methods=['POST'])
def api_up_status():
    d = request.json; s = d.get('latestStatus') or d.get('newStatus', 'DUE')
    return jsonify({'success': update_status(d['docNum'], s, d.get('newRev',''))})
@app.route('/api/db_info')
def api_db_info(): return jsonify({'inputFile': INPUT_DB.name if INPUT_DB.exists() else 'Missing', 'outputFile': OUTPUT_DB.name, 'status': 'online'})
@app.route('/')
def index_api(): return jsonify({"status":"online","detail":"full-service"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5500, debug=True)
