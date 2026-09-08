/**
 * 设置中心 · 偏好 + 游戏分组（从 SettingsPage 拆出）：
 * - 偏好：可扩展主题系统（内置套色 + 自定义主题 + 界面密度 + 全局偏好）、组件外观（胶囊 / 日期独立主题 / 布局风格 / 番茄专注）
 * - 游戏：讨伐 / 经验升级开关（实验性功能，默认关闭）
 */
import { useState } from 'react'
import { Icon } from '../../components/framework/Icon'
import { Dropdown } from '../../components/framework/Dropdown'
import { Capsule } from '../../components/framework/Capsule'
import { DateCal } from '../../components/framework/DateCal'
import { useToast } from '../../components/framework/Toast'
import { applyDensity, applyTheme, THEME_REGISTRY, activeCloudTheme, saveCloudTheme as saveCloudThemePref, readCustomTheme, writeCustomTheme, clearCustomTheme, CUSTOM_VAR_KEYS, type ThemePref, type DensityPref } from '../../lib/theme'
import { todayYMD } from '../../lib/date'
import { timelineLayout, setTimelineLayout, type TimelineLayout } from '../../lib/layout'
import { readGamePrefs, writeGamePrefs, type GamePrefs } from '../../lib/gamePrefs'
import { CAPSULE_THEMES, readTheme, writeTheme, listDayThemes, writeDayTheme, removeDayTheme, clearDayThemes, themeLabel, LAYOUT_THEMES, readLayoutTheme, writeLayoutTheme, POMODORO_THEMES, type ThemeVariant } from '../../lib/componentTheme'
import { readPomodoroPrefs, writePomodoroPref, type PomodoroPrefs, type PomodoroKey } from '../../lib/pomodoro'
import { Sec, Row } from './shared'

/** 通用组件风格下拉：任意一组 ThemeVariant（胶囊主题 / 各区域布局风格） */
const StyleSelect = ({ variants, value, onChange }: { variants: ThemeVariant[]; value: string; onChange: (id: string) => void }) => (
  <Dropdown
    value={value}
    width={240}
    align="left"
    onChange={onChange}
    ariaLabel="选择组件风格"
    options={variants.map((t) => ({ value: t.id, label: `${t.label} · ${t.desc}`, swatch: t.swatch }))}
  />
)

/** 胶囊主题下拉（选项带色块，选中即时保存） */
const ThemeSelect = ({ value, onChange }: { value: string; onChange: (id: string) => void }) => (
  <StyleSelect variants={CAPSULE_THEMES} value={value} onChange={onChange} />
)

export const PrefsGroup = ({ g }: { g: 'prefs' | 'game' }) => {
  const toast = useToast()

  // 偏好（需求 15：主题系统）
  const [themeBase, setThemeBase] = useState<ThemePref>((localStorage.getItem('cl_theme') as ThemePref) || 'auto')
  const [cloudTheme, setCloudTheme] = useState(localStorage.getItem('cl_cloud_theme') || 'default')
  const [customTheme, setCustomTheme] = useState(readCustomTheme())
  const [density, setDensity] = useState<DensityPref>((localStorage.getItem('cl_density') as DensityPref) || 'standard')
  const [defPage, setDefPage] = useState(localStorage.getItem('cl_default_page') || '/')
  const [tlLayout, setTlLayout] = useState<TimelineLayout>(timelineLayout)
  const [sidePref, setSidePref] = useState(localStorage.getItem('cl_sidebar') === 'pinned' ? 'pinned' : 'collapsed')
  // 游戏化开关（讨伐 / 经验升级，默认关闭，待优化后再放出）
  const [game, setGame] = useState<GamePrefs>(readGamePrefs)
  const saveGame = (p: GamePrefs) => {
    setGame(p)
    writeGamePrefs(p)
    toast(p.battle || p.xp ? '游戏化功能已开启（本机偏好，立即生效）' : '游戏化功能已全部关闭')
  }
  // 组件主题偏好（骨架不变 · 样式抽离）
  const [capsuleTheme, setCapsuleThemeState] = useState(() => readTheme('capsule', CAPSULE_THEMES, 'glass'))
  const [dayOverrides, setDayOverrides] = useState<Record<string, string>>(() => listDayThemes())
  const [dayPicker, setDayPicker] = useState(todayYMD())
  const [dayCalOpen, setDayCalOpen] = useState(false)
  const [layoutPrefs, setLayoutPrefs] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const gd of LAYOUT_THEMES) o[gd.key] = readLayoutTheme(gd.key, gd.variants, gd.variants[0]?.id ?? '')
    return o
  })
  const [pomo, setPomo] = useState<PomodoroPrefs>(readPomodoroPrefs)
  const [pomoTheme, setPomoTheme] = useState(() => readLayoutTheme('pomodoro', POMODORO_THEMES, 'blue'))

  /* ========== 偏好 ========== */
  const saveThemeBase = (v: ThemePref) => { setThemeBase(v); applyTheme(v); toast('外观基础已保存') }
  const selectCloudTheme = (id: string) => {
    setCloudTheme(id); saveCloudThemePref(id); applyTheme(themeBase); toast('主题已切换')
  }
  const saveDensity = (v: DensityPref) => { setDensity(v); localStorage.setItem('cl_density', v); applyDensity(v) }
  const saveCustomTheme = (patch: { base?: ThemePref; key?: string; value?: string }) => {
    const cur = customTheme ?? { base: themeBase, vars: {} }
    const next = { base: patch.base ?? cur.base, vars: { ...cur.vars } }
    if (patch.key !== undefined) next.vars[patch.key] = patch.value ?? ''
    setCustomTheme(next); writeCustomTheme(next); applyTheme(themeBase)
  }
  const resetCustomTheme = () => { clearCustomTheme(); setCustomTheme(null); applyTheme(themeBase); toast('自定义主题已清除') }
  const saveSidePref = (v: string) => { setSidePref(v); localStorage.setItem('cl_sidebar', v); toast(v === 'pinned' ? '侧边栏默认展开已保存' : '侧边栏默认折叠已保存') }
  const saveTlLayout = (v: TimelineLayout) => { setTlLayout(v); setTimelineLayout(v) }
  /* 组件主题（胶囊 / 日期独立 / 布局风格 / 番茄专注） */
  const saveCapsuleTheme = (v: string) => {
    setCapsuleThemeState(v); writeTheme('capsule', v)
    toast(`日期胶囊主题：${themeLabel(v)}`)
  }
  const saveLayoutPref = (key: string, v: string) => { writeLayoutTheme(key, v); setLayoutPrefs((p) => ({ ...p, [key]: v })) }
  const savePomo = (key: PomodoroKey, value: number | boolean) => { writePomodoroPref(key, value); setPomo(readPomodoroPrefs()) }
  const savePomoThemeF = (v: string) => { writeLayoutTheme('pomodoro', v); setPomoTheme(v) }
  const saveDayPickerTheme = (id: string) => { writeDayTheme(dayPicker, id); setDayOverrides(listDayThemes()); toast(`已为 ${dayPicker} 设置独立主题`) }
  const resetDayPickerTheme = () => { removeDayTheme(dayPicker); setDayOverrides(listDayThemes()) }
  const resetAllDayThemesF = () => { clearDayThemes(); setDayOverrides({}) }

  return (
    <>
      {g === 'prefs' && (
        <>
          <Sec icon="palette" title="主题系统" tip="亮/暗骨架 + 套色主题叠加；支持自定义主题与第三方主题扩展接口">
            <Row k="外观基础" tip="亮色 / 暗色 / 跟随系统（决定主题骨架）">
              <Dropdown value={themeBase} options={[{ value: 'light', label: '亮色' }, { value: 'dark', label: '暗色' }, { value: 'auto', label: '跟随系统' }]} onChange={(v) => saveThemeBase(v as ThemePref)} />
            </Row>
            <Row k="套色主题" tip="在骨架之上叠加的主色调色板（云笺蓝 / 墨韵灰 / 青藤绿 / 落日橙 / 星夜青…）">
              <div className="th-grid">
                {THEME_REGISTRY.map((t) => (
                  <button key={t.id} className={`th-card${cloudTheme === t.id ? ' on' : ''}`} onClick={() => selectCloudTheme(t.id)}>
                    <span className="th-swatches"><i style={{ background: t.swatch[0] }} /><i style={{ background: t.swatch[1] }} /></span>
                    <b>{t.label}</b><em>{t.base === 'dark' ? '暗色' : '亮色'}</em>
                  </button>
                ))}
                <button className={`th-card${cloudTheme === 'custom' ? ' on' : ''}`} onClick={() => { selectCloudTheme('custom'); setCloudTheme('custom') }}>
                  <span className="th-swatches"><i style={{ background: 'linear-gradient(90deg,#f97316,#2f6df6,#06b6d4)' }} /><i style={{ background: 'linear-gradient(90deg,#06b6d4,#2f6df6)' }} /></span>
                  <b>自定义</b><em>({activeCloudTheme()?.custom ? '已启用' : '未启用'})</em>
                </button>
              </div>
            </Row>
            <Row k="自定义主题" tip="编辑主色 / 辅色（品牌渐变），保存后实时应用">
              <div className="ct-editor">
                <label>骨架
                  <select value={customTheme?.base ?? 'light'} onChange={(e) => saveCustomTheme({ base: e.target.value as ThemePref })}>
                    <option value="light">亮色</option><option value="dark">暗色</option>
                  </select>
                </label>
                {CUSTOM_VAR_KEYS.map(({ key, label }) => (
                  <label key={key}>{label}
                    <input type="text" value={customTheme?.vars?.[key] ?? ''} placeholder="#hex 色值"
                      onChange={(e) => saveCustomTheme({ key, value: e.target.value })} />
                  </label>
                ))}
                <button className="btn slim ghost" onClick={resetCustomTheme}>清除自定义主题</button>
              </div>
            </Row>
            <Row k="界面密度" tip="标准 / 紧凑（间距与圆角全局收紧）">
              <Dropdown value={density} options={[{ value: 'standard', label: '标准' }, { value: 'compact', label: '紧凑' }]} onChange={(v) => saveDensity(v as DensityPref)} />
            </Row>
            <Row k="默认页面" tip="登录后首先进入">
              <Dropdown value={defPage} options={[{ value: '/', label: '时间线' }, { value: '/posts', label: '文章' }, { value: '/daily', label: '日常' }, { value: '/goals-home', label: '目标' }, { value: '/ledger', label: '记账本' }]} onChange={(v) => { setDefPage(v); localStorage.setItem('cl_default_page', v) }} />
            </Row>
            <Row k="侧边栏默认" tip="未手动操作时的默认状态；折叠态仍支持悬停临时展开">
              <Dropdown value={sidePref} options={[{ value: 'collapsed', label: '默认折叠（推荐）' }, { value: 'pinned', label: '默认展开' }]} onChange={(v) => saveSidePref(v)} />
            </Row>
            <Row k="时光长河布局" tip="气泡在轴上的排布方式">
              <Dropdown value={tlLayout} options={[{ value: 'river', label: '🌊 河流蜿蜒' }, { value: 'axis', label: '｜居中轴线' }, { value: 'list', label: '☰ 单列列表' }]} onChange={(v) => saveTlLayout(v as TimelineLayout)} />
            </Row>
          </Sec>
          <Sec icon="spark" title="组件外观" tip="组件主题可独立切换 · 骨架不变、样式抽离（含日期独立主题）">
            <Row k="日期选择胶囊" tip="时光长河悬浮日期选择的外观主题">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                <Capsule className="capsule-demo" theme={capsuleTheme} icon="cal" value={themeLabel(capsuleTheme)} extra={<span className="cap-grip">⠿</span>} />
                <ThemeSelect value={capsuleTheme} onChange={saveCapsuleTheme} />
              </div>
            </Row>
            <Row k="日期独立主题" tip="时间线上每个日期都能单独换主题 · 未设置的日期跟随全局胶囊主题">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                <div className="set-day-pick" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn slim" onClick={() => setDayCalOpen((v) => !v)}>📅 {dayPicker}</button>
                  {dayCalOpen && <DateCal value={dayPicker} onChange={(ymd) => { setDayPicker(ymd); setDayCalOpen(false) }} />}
                  {dayOverrides[dayPicker] && <button className="btn slim ghost" onClick={resetDayPickerTheme}>恢复跟随全局</button>}
                  <ThemeSelect value={dayOverrides[dayPicker] ?? capsuleTheme} onChange={saveDayPickerTheme} />
                </div>
                {Object.keys(dayOverrides).length > 0 && (
                  <div className="day-override-list">
                    {Object.entries(dayOverrides).map(([ymd, tid]) => (
                      <span key={ymd} className="day-ov-chip">
                        <span className="day-ov-dot" style={{ background: CAPSULE_THEMES.find((t) => t.id === tid)?.swatch }} />
                        <b>{ymd}</b><i>{themeLabel(tid)}</i>
                        <button title="恢复跟随全局" onClick={() => { removeDayTheme(ymd); setDayOverrides(listDayThemes()) }}><Icon name="x" size={12} /></button>
                      </span>
                    ))}
                    <button className="btn slim ghost danger-ghost" onClick={resetAllDayThemesF}>清空全部</button>
                  </div>
                )}
              </div>
            </Row>
            {LAYOUT_THEMES.map((gd) => (
              <Row key={gd.key} k={gd.label} tip={gd.variants.find((v) => v.id === layoutPrefs[gd.key])?.desc}>
                <StyleSelect variants={gd.variants} value={layoutPrefs[gd.key] ?? gd.variants[0]?.id ?? ''} onChange={(v) => saveLayoutPref(gd.key, v)} />
              </Row>
            ))}
            <Row k="番茄专注外观" tip="时间球与循环点的配色">
              <StyleSelect variants={POMODORO_THEMES} value={pomoTheme} onChange={savePomoThemeF} />
            </Row>
            <Row k="番茄专注时长" tip="每轮专注 / 短休息 / 长休息的时长与每日目标">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={String(pomo.focus)} onChange={(e) => savePomo('focus', Number(e.target.value))}>
                  {[15, 25, 45].map((v) => <option key={v} value={v}>{v} 分钟专注</option>)}
                </select>
                <select value={String(pomo.short)} onChange={(e) => savePomo('short', Number(e.target.value))}>
                  {[3, 5, 10].map((v) => <option key={v} value={v}>{v} 分钟短休</option>)}
                </select>
                <select value={String(pomo.every)} onChange={(e) => savePomo('every', Number(e.target.value))}>
                  {[3, 4, 5].map((v) => <option key={v} value={v}>每 {v} 轮长休</option>)}
                </select>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={pomo.auto} onChange={(e) => savePomo('auto', e.target.checked)} />自动衔接
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={pomo.sound} onChange={(e) => savePomo('sound', e.target.checked)} />完成提示音
                </label>
              </div>
            </Row>
          </Sec>
        </>
      )}

      {g === 'game' && (
        <Sec icon="flame" title="游戏化（实验）" tip="讨伐与经验升级正在重做，先默认隐藏；开关为本机偏好，保存后立即生效">
          <Row k="讨伐模式" tip="总览讨伐卡与 3D 宇宙的 ⚔️ 入口（关闭时相关界面全部隐藏）">
            <div className="seg">
              <button type="button" className={`seg-btn${game.battle ? ' on' : ''}`} onClick={() => saveGame({ ...game, battle: true })}>开启</button>
              <button type="button" className={`seg-btn${!game.battle ? ' on' : ''}`} onClick={() => saveGame({ ...game, battle: false })}>关闭（默认）</button>
            </div>
          </Row>
          <Row k="经验与等级" tip="头像等级徽标 / 升级庆祝动效 / +XP 提示">
            <div className="seg">
              <button type="button" className={`seg-btn${game.xp ? ' on' : ''}`} onClick={() => saveGame({ ...game, xp: true })}>开启</button>
              <button type="button" className={`seg-btn${!game.xp ? ' on' : ''}`} onClick={() => saveGame({ ...game, xp: false })}>关闭（默认）</button>
            </div>
          </Row>
          <Row k="说明">
            <span className="dim" style={{ fontSize: 12.5 }}>两项默认关闭；经验数据仍在后台累积，重新开启后等级按全部沉淀计算，不会丢失。</span>
          </Row>
        </Sec>
      )}
    </>
  )
}
