/** 通用加载态：时长河/节点宇宙等场景数据未就绪时的极简动画（纯 CSS 转圈 + 文案） */
export function Loading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="tl-loading" role="status" aria-live="polite">
      <span className="ld-spinner" aria-hidden="true" />
      <i>{label}</i>
    </div>
  )
}