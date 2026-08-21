/// <reference types="mdast" />
/**
 * wikilink 插件（§5.2.4 / N9）：[[目标|显示]] → 站内链接。
 * 项目根由 astro.config.mjs 显式传入（避免 Vite bundle 重写 import.meta.url）。
 * 目标存在 → <a class="wikilink" href="/dev/posts/slug/">；
 * 目标不存在 → §14 灰色"待创建" span。
 */
import { visit } from "unist-util-visit";
import { resolveTarget } from "../utils/backlinks.mjs";

// Astro base 前缀（与 astro.config.mjs 的 base 保持一致）
const BASE = "/dev";

export function remarkWikilink(options = {}) {
	const rootDir = options.projectRoot;
	return (tree) => {
		visit(tree, "text", (node, index, parent) => {
			if (!parent || index === null || !node.value.includes("[[")) return;
			const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
			const parts = [];
			let last = 0;
			let m;
			while ((m = re.exec(node.value))) {
				const target = m[1].trim();
				const label = (m[2] ?? "").trim() || target;
				if (m.index > last) {
					parts.push({ type: "text", value: node.value.slice(last, m.index) });
				}
				const slug = resolveTarget(target, rootDir);
				if (slug) {
					parts.push({
						type: "html",
						value: `<a class="wikilink" href="${BASE}/posts/${encodeURIComponent(slug)}/">${escapeHtml(label)}</a>`,
					});
				} else {
					parts.push({
						type: "html",
						value: `<span class="wikilink wikilink-missing" title="待创建：${escapeHtml(target)}">${escapeHtml(label)}</span>`,
					});
				}
				last = re.lastIndex;
			}
			if (!parts.length) return;
			if (last < node.value.length) {
				parts.push({ type: "text", value: node.value.slice(last) });
			}
			parent.children.splice(index, 1, ...parts);
			return [visit.SKIP, index + parts.length];
		});
	};
}

function escapeHtml(s) {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
