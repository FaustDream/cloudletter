/**
 * 密码复杂度规则（需求：必须同时包含中文与英文；不能仅由数字、也不能仅由英文组成；
 * 不强制大小写组合与特殊字符）：
 * - /[\u4e00-\u9fff]/ 至少一个汉字
 * - /[a-zA-Z]/ 至少一个英文字母
 * - 两个条件同时满足即通过（数字/符号随意混合）
 */
export function passwordPolicyError(pw: string): string | null {
  const hasHan = /[\u4e00-\u9fff]/.test(pw)
  const hasEn = /[a-zA-Z]/.test(pw)
  if (!hasHan) return '密码必须包含至少一个中文字符'
  if (!hasEn) return '密码必须包含至少一个英文字母'
  return null
}