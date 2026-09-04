/**
 * BlockNote 中文词典（0.54 dictionary i18n）：官方 en 词典打底，本文件仅维护中文覆盖项。
 * 结构对齐 core i18n Dictionary；覆盖界面可见文案：斜杠菜单 / 占位符 / 工具栏提示 / 侧边手柄 / 表格手柄 / 取色器 / 文件面板 / 链接栏。
 * 不再手写全量键——0.54 react 层会读取 slash_menu.heading 等全部内置键，手写漏键即编辑器崩溃（缺键回退英文）。
 */
import { en, type Dictionary } from '@blocknote/core/locales'

type Plain = Record<string, unknown>

/** 深合并：override 为部分覆盖（叶子整体替换），base 保证键完整 */
function deepMergeEn(base: Plain, override: Plain): Dictionary {
  const out: Plain = { ...base }
  for (const [k, v] of Object.entries(override)) {
    const b = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)
        ? deepMergeEn(b as Plain, v as Plain)
        : v
  }
  return out as Dictionary
}

const zhOverrides = {
  slash_menu: {
    heading_1: { title: '标题 1', subtext: '顶级标题', aliases: ['h', 'heading1', 'h1'], group: '标题' },
    heading_2: { title: '标题 2', subtext: '关键章节标题', aliases: ['h2', 'heading2', 'subheading'], group: '标题' },
    heading_3: { title: '标题 3', subtext: '小节标题', aliases: ['h3', 'heading3', 'subheading'], group: '标题' },
    heading_4: { title: '标题 4', subtext: '次级小节', aliases: ['h4', 'heading4'], group: '小标题' },
    heading_5: { title: '标题 5', subtext: '小型小节', aliases: ['h5', 'heading5'], group: '小标题' },
    heading_6: { title: '标题 6', subtext: '最低级标题', aliases: ['h6', 'heading6'], group: '小标题' },
    toggle_heading: { title: '可折叠标题 1', subtext: '可折叠的顶级标题', aliases: ['h', 'heading1', 'h1', 'collapsable'], group: '小标题' },
    toggle_heading_2: { title: '可折叠标题 2', subtext: '可折叠的章节标题', aliases: ['h2', 'heading2', 'collapsable'], group: '小标题' },
    toggle_heading_3: { title: '可折叠标题 3', subtext: '可折叠的小节标题', aliases: ['h3', 'heading3', 'collapsable'], group: '小标题' },
    quote: { title: '引用', subtext: '引用或摘录', aliases: ['quotation', 'blockquote', 'bq', '引用'], group: '基础块' },
    toggle_list: { title: '折叠列表', subtext: '可隐藏子项的列表', aliases: ['li', 'list', 'togglelist', '折叠'], group: '基础块' },
    numbered_list: { title: '有序列表', subtext: '带序号的列表', aliases: ['ol', 'li', 'list', 'numberedlist', '有序'], group: '基础块' },
    bullet_list: { title: '无序列表', subtext: '带圆点的列表', aliases: ['ul', 'li', 'list', 'bulletlist', '无序'], group: '基础块' },
    check_list: { title: '任务列表', subtext: '带复选框的列表', aliases: ['ul', 'li', 'list', 'checklist', '任务', 'todo'], group: '基础块' },
    paragraph: { title: '正文', subtext: '普通文本段落', aliases: ['p', 'paragraph', '正文'], group: '基础块' },
    code_block: { title: '代码块', subtext: '带语法高亮的代码块', aliases: ['code', 'pre', '代码'], group: '基础块' },
    page_break: { title: '分页符', subtext: '页面分隔符', aliases: ['page', 'break', 'separator'], group: '基础块' },
    table: { title: '表格', subtext: '可编辑单元格的表格', aliases: ['table', '表格'], group: '高级' },
    image: { title: '图片', subtext: '可调大小、带说明的图片', aliases: ['image', 'imageUpload', 'upload', 'img', 'picture', 'media', 'url', '图片'], group: '媒体' },
    video: { title: '视频', subtext: '可调大小的视频', aliases: ['video', 'videoUpload', 'mp4', 'film', 'media', 'url', '视频'], group: '媒体' },
    audio: { title: '音频', subtext: '嵌入式音频', aliases: ['audio', 'audioUpload', 'mp3', 'sound', 'media', 'url', '音频'], group: '媒体' },
    file: { title: '文件', subtext: '嵌入式文件', aliases: ['file', 'upload', 'embed', 'media', 'url', '文件'], group: '媒体' },
    emoji: { title: '表情', subtext: '搜索并插入表情', aliases: ['emoji', 'emote', 'emotion', 'face', '表情'], group: '其他' },
    divider: { title: '分割线', subtext: '视觉分隔内容', aliases: ['divider', 'hr', 'line', 'horizontal rule', '分割'], group: '基础块' },
  },
  placeholders: {
    default: "输入内容，输入 '/' 唤起命令菜单",
    heading: '标题',
    toggleListItem: '列表',
    bulletListItem: '列表',
    numberedListItem: '列表',
    checkListItem: '列表',
    emptyDocument: undefined,
    new_comment: '写一条评论…',
    edit_comment: '编辑评论…',
    comment_reply: '回复评论…',
  },
  file_blocks: {
    add_button_text: { image: '添加图片', video: '添加视频', audio: '添加音频', file: '添加文件' },
  },
  toggle_blocks: { add_block_button: '空折叠块。点击添加内容。' },
  code_block: { add_source_button_text: '添加源代码', ok_button_text: '确定' },
  side_menu: { add_block_label: '添加块', drag_handle_label: '打开块菜单' },
  drag_handle: {
    delete_menuitem: '删除',
    colors_menuitem: '颜色',
    header_row_menuitem: '表头行',
    header_column_menuitem: '表头列',
  },
  table_handle: {
    delete_column_menuitem: '删除列',
    delete_row_menuitem: '删除行',
    add_left_menuitem: '左侧插入列',
    add_right_menuitem: '右侧插入列',
    add_above_menuitem: '上方插入行',
    add_below_menuitem: '下方插入行',
    split_cell_menuitem: '拆分单元格',
    merge_cells_menuitem: '合并单元格',
    background_color_menuitem: '背景颜色',
  },
  suggestion_menu: { no_items_title: '没有匹配的项' },
  color_picker: {
    text_title: '文字颜色',
    background_title: '背景颜色',
    colors: {
      default: '默认', gray: '灰色', brown: '棕色', red: '红色', orange: '橙色',
      yellow: '黄色', green: '绿色', blue: '蓝色', purple: '紫色', pink: '粉色',
    },
  },
  formatting_toolbar: {
    bold: { tooltip: '加粗', secondary_tooltip: 'Ctrl+B' },
    italic: { tooltip: '斜体', secondary_tooltip: 'Ctrl+I' },
    underline: { tooltip: '下划线', secondary_tooltip: 'Ctrl+U' },
    strike: { tooltip: '删除线', secondary_tooltip: 'Ctrl+Shift+S' },
    code: { tooltip: '行内代码', secondary_tooltip: '' },
    colors: { tooltip: '颜色' },
    link: { tooltip: '插入链接', secondary_tooltip: 'Ctrl+K' },
    file_caption: { tooltip: '编辑说明', input_placeholder: '编辑说明' },
    file_replace: { tooltip: { image: '替换图片', video: '替换视频', audio: '替换音频', file: '替换文件' } },
    file_rename: { tooltip: { image: '重命名图片', video: '重命名视频', audio: '重命名音频', file: '重命名文件' }, input_placeholder: { image: '重命名图片', video: '重命名视频', audio: '重命名音频', file: '重命名文件' } },
    file_download: { tooltip: { image: '下载图片', video: '下载视频', audio: '下载音频', file: '下载文件' } },
    file_delete: { tooltip: { image: '删除图片', video: '删除视频', audio: '删除音频', file: '删除文件' } },
    file_preview_toggle: { tooltip: '切换预览' },
    nest: { tooltip: '增加缩进', secondary_tooltip: 'Tab' },
    unnest: { tooltip: '减少缩进', secondary_tooltip: 'Shift+Tab' },
    align_left: { tooltip: '左对齐' },
    align_center: { tooltip: '居中对齐' },
    align_right: { tooltip: '右对齐' },
    align_justify: { tooltip: '两端对齐' },
    table_cell_merge: { tooltip: '合并单元格' },
    comment: { tooltip: '添加评论' },
  },
  file_panel: {
    upload: {
      title: '上传',
      file_placeholder: { image: '上传图片', video: '上传视频', audio: '上传音频', file: '上传文件' },
      upload_error: '错误：上传失败',
    },
    embed: {
      title: '嵌入',
      embed_button: { image: '嵌入图片', video: '嵌入视频', audio: '嵌入音频', file: '嵌入文件' },
      url_placeholder: '输入链接',
    },
  },
  link_toolbar: {
    delete: { tooltip: '移除链接' },
    edit: { text: '编辑链接', tooltip: '编辑' },
    open: { tooltip: '在新标签页打开' },
    form: { title_placeholder: '链接标题', url_placeholder: '链接地址' },
  },
  comments: {
    edited: '已编辑',
    save_button_text: '保存',
    cancel_button_text: '取消',
    deleted_reference_text: '原始内容已删除',
    discard_pending_comment: '确定放弃这条评论？',
    actions: { add_reaction: '添加表情', resolve: '标记已解决', reopen: '重新打开', edit_comment: '编辑评论', delete_comment: '删除评论', more_actions: '更多操作' },
    reactions: { reacted_by: '表态者' },
    sidebar: { marked_as_resolved: '标记为已解决', more_replies: (n: number) => `还有 ${n} 条回复` },
  },
  suggestion_changes: {
    formatting_change: '格式变更',
    deleted: '已删除',
    inserted_by: (u: string) => `插入者：${u}`,
    deleted_by: (u: string) => `删除者：${u}`,
    formatting_change_by: (u: string, t: string) => `格式变更（${t}）· ${u}`,
  },
  exporter: { open_file: '打开文件', open_video_file: '打开视频', open_audio_file: '打开音频' },
  generic: { ctrl_shortcut: 'Ctrl' },
} as const satisfies Record<string, unknown>

export const zhDictionary: Dictionary = deepMergeEn(en as unknown as Plain, zhOverrides as unknown as Plain)
