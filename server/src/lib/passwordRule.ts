/**
 * 密码复杂度规则（必须同时包含数字与英文字母；不强制大小写组合、特殊字符与中文）：
 * - /[0-9]/ 至少一个数字
 * - /[a-zA-Z]/ 至少一个英文字母
 * - 两个条件同时满足即通过（中文/符号随意混合，不作要求）
 */
export function passwordPolicyError(pw: string): string | null {
  const hasDigit = /[0-9]/.test(pw)
  const hasEn = /[a-zA-Z]/.test(pw)
  if (!hasDigit) return '密码必须包含至少一个数字'
  if (!hasEn) return '密码必须包含至少一个英文字母'
  return null
}
