# 第二批：Ledger / QuickActions / PlanPage 的原生 select 替换
import io

def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    print('patched', p)

def add_import(s, imp):
    if imp.split(' from ')[1].strip("' ") in s:
        return s
    lines = s.split('\n')
    idx = max(i for i, l in enumerate(lines) if l.startswith('import '))
    lines.insert(idx + 1, imp)
    return '\n'.join(lines)

# ── LedgerPage：分类筛选 / 月份筛选 / 弹窗分类 ──
p = 'src/pages/LedgerPage.tsx'
s = rd(p)
subs = [
  ("""            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="fsel">
              <option value="">全部分类</option>
              {CATS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>""",
   """            <Dropdown
              value={catFilter}
              align="left"
              options={[{ value: '', label: '全部分类' }, ...CATS.map((c) => ({ value: c, label: c }))]}
              onChange={setCatFilter}
            />"""),
  ("""          <Field label="分类">
            <select value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })}>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>""",
   """          <Field label="分类">
            <Dropdown
              value={form.cat}
              align="left"
              options={CATS.map((c) => ({ value: c, label: c }))}
              onChange={(c) => setForm({ ...form, cat: c })}
            />
          </Field>"""),
]
for old, new in subs:
    assert old in s, 'ledger NOT FOUND: ' + old[:60]
    s = s.replace(old, new)
s = add_import(s, "import { Dropdown } from '../components/framework/Dropdown'")
wr(p, s)

# ── QuickActions：笔记分类 / 记账分类 ──
p = 'src/components/framework/QuickActions.tsx'
s = rd(p)
import re
# 找到两处 select 的完整块再替换（宽松匹配：以 <select 开头到 </select>）
pat = re.compile(r'<select value=\{pCat\}[^>]*>.*?</select>', re.S)
m = pat.search(s)
assert m, 'pCat select NOT FOUND'
s = s.replace(m.group(0), """<Dropdown
              value={pCat}
              align="left"
              options={(cats.length ? cats : [{ name: '灵感' }, { name: '生活' }, { name: '工作' }]).map((c) => ({ value: c.name, label: c.name }))}
              onChange={(v) => setPCat(v)}
            />""")
pat2 = re.compile(r'<select value=\{lCat\}[^>]*>.*?</select>', re.S)
m2 = pat2.search(s)
assert m2, 'lCat select NOT FOUND'
s = s.replace(m2.group(0), """<Dropdown
              value={lCat}
              align="left"
              options={(cats.length ? cats : CATS_FALLBACK).map((c) => ({ value: c.name, label: c.name }))}
              onChange={(v) => setLCat(v)}
            />""")
s = add_import(s, "import { Dropdown } from './Dropdown'")
# CATS_FALLBACK 常量（抽屉分类加载失败时兜底）
s = s.replace("type Action = 'post' | 'note' | 'ledger' | null",
              "type Action = 'post' | 'note' | 'ledger' | null\n\nconst CATS_FALLBACK = [\n  { name: '餐饮' }, { name: '交通' }, { name: '购物' }, { name: '居住' }, { name: '娱乐' },\n  { name: '学习' }, { name: '健康' }, { name: '工作' }, { name: '理财' }, { name: '其他' },\n]")
wr(p, s)

# ── PlanPage：优先级选择 ──
p = 'src/pages/PlanPage.tsx'
s = rd(p)
pat3 = re.compile(r'<select value=\{level\}[^>]*>.*?</select>', re.S)
m3 = pat3.search(s)
assert m3, 'level select NOT FOUND'
s = s.replace(m3.group(0), """<Dropdown
                value={level}
                align="left"
                options={[
                  { value: 'P0', label: 'P0 · 紧急' },
                  { value: 'P1', label: 'P1 · 重要' },
                  { value: 'P2', label: 'P2 · 一般' },
                ]}
                onChange={(v) => setLevel(v as 'P0' | 'P1' | 'P2')}
              />""")
s = add_import(s, "import { Dropdown } from '../components/framework/Dropdown'")
wr(p, s)

print('BATCH 2 DONE')
