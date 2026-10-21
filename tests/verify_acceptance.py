import httpx

base = 'http://127.0.0.1:8000'
proxy_base = 'http://127.0.0.1:5173'

print('Testing health...')
r = httpx.get(f'{base}/api/health')
assert r.status_code == 200, r.text
print('Direct Health:', r.json())

print('Testing health via Vite proxy...')
r = httpx.get(f'{proxy_base}/api/health')
assert r.status_code == 200, r.text
print('Proxy Health:', r.json())

samples = httpx.get(f'{base}/api/samples').json()
print('Samples loaded:', len(samples))

# Q1 check: Q1 -> 22 days, 2 critical paths
q1 = httpx.post(f'{proxy_base}/api/solve', json=samples['q1_manuscript']).json()
dur = q1['summary']['project_duration']
cp_count = q1['summary']['critical_path_count']
assert dur == 22, f'Q1 duration expected 22, got {dur}'
assert cp_count == 2, f'Q1 critical paths expected 2, got {cp_count}'
print(f'[PASS] Q1 Manuscript: {dur} days, {cp_count} critical paths')

# Q2 check: Q2 -> 11 days (warning about dangling event 3 shown)
q2 = httpx.post(f'{proxy_base}/api/solve', json=samples['q2_workshop']).json()
dur = q2['summary']['project_duration']
assert dur == 11, f'Q2 duration expected 11, got {dur}'
assert any('3' in w or 'Dangling' in w for w in q2['warnings']), 'Q2 warning about dangling event 3 not found'
print(f'[PASS] Q2 Workshop: {dur} days, dangling event 3 warning confirmed')

# Q3 check: Q3 (rounded) -> 39, variance 3
q3 = httpx.post(f'{proxy_base}/api/solve', json=samples['q3_site_prep']).json()
dur = q3['summary']['project_duration']
var = q3['pert_analysis']['variance']
assert dur == 39, f'Q3 duration expected 39, got {dur}'
assert var == 3, f'Q3 variance expected 3, got {var}'
print(f'[PASS] Q3 Site prep (rounded): {dur} days, variance {var}')

# Q4 check: Q4 -> 17, sigma 3, P(<=13) approx 0.0918 (table)
q4 = httpx.post(f'{proxy_base}/api/solve', json=samples['q4_pert_probability']).json()
dur = q4['summary']['project_duration']
sd = q4['pert_analysis']['std_dev']
q4_query = q4['pert_analysis']['queries'][0]
p_table = q4_query['p_le_table']
assert dur == 17, f'Q4 duration expected 17, got {dur}'
assert sd == 3, f'Q4 std dev expected 3, got {sd}'
assert p_table == 0.0918, f'Q4 P(<=13) expected 0.0918, got {p_table}'
print(f'[PASS] Q4 PERT probability: {dur} days, sigma={sd}, P(<=13)={p_table}')

# Q5 check: Q5 -> diagram only
q5 = httpx.post(f'{proxy_base}/api/solve', json=samples['q5_diagram_only']).json()
assert q5['timed'] is False, 'Q5 timed should be False'
assert 'svg' in q5['graph'] and q5['graph']['svg'].startswith('<svg'), 'Q5 valid svg generated'
print('[PASS] Q5 Diagram only: timed=False, interactive SVG generated')

# Q6 check: Q6 -> 25 days, critical A -> B -> C -> L -> M
q6 = httpx.post(f'{proxy_base}/api/solve', json=samples['q6_float']).json()
dur = q6['summary']['project_duration']
cp_label = q6['critical_paths'][0]['label']
assert dur == 25, f'Q6 duration expected 25, got {dur}'
assert cp_label == 'A → B → C → L → M', f'Q6 critical path expected A → B → C → L → M, got {cp_label}'
print(f'[PASS] Q6 Float & Critical Path: {dur} days, critical path A -> B -> C -> L -> M')

print('\n=============================================')
print('ALL 6 COURSE GUIDE ACCEPTANCE CHECKS PASSED!')
print('=============================================')
