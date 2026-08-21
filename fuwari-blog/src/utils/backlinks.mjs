/**
 * 构建期双链数据（§5.2.4 / N9）：
 * 扫描 src/content/posts/*.md，建立 titleToSlug / slugSet / slugToReferrers。
 * 项目根优先用显式传入的 rootDir（来自 astro.config.mjs，避免 Vite bundle 重写 import.meta.url），
 * 否则回退到 import.meta.url 推导（页面 frontmatter 环境已验证可靠）。
 * 无缓存，每次扫描（文件量小，毫秒级，规避跨环境模块实例的缓存时序问题）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const TITLE_RE = /^title:\s*(.+)$/m;
const DESC_RE = /^description:\s*(.+)$/m;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_ROOT = path.resolve(__dirname, "..", "..");

function scan(rootDir) {
	const titleToSlug = new Map();
	const slugSet = new Set();
	const slugToReferrers = new Map();
	const slugToMeta = new Map();
	const dir = path.join(rootDir, "src", "content", "posts");

	let files = [];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return { titleToSlug, slugSet, slugToReferrers, slugToMeta };
	}

	const entries = [];
	for (const f of files) {
		let raw = "";
		try {
			raw = fs.readFileSync(path.join(dir, f), "utf-8");
		} catch {
			continue;
		}
		const slug = f.replace(/\.md$/, "");
		const title = (raw.match(TITLE_RE)?.[1] ?? "")
			.trim()
			.replace(/^["']|["']$/g, "");
		const description = (raw.match(DESC_RE)?.[1] ?? "")
			.trim()
			.replace(/^["']|["']$/g, "");
		entries.push({ title, slug, description, raw });
		if (title) titleToSlug.set(title, slug);
		slugSet.add(slug);
		slugToMeta.set(slug, { title, description });
	}

	for (const e of entries) {
		WIKILINK_RE.lastIndex = 0;
		let m;
		while ((m = WIKILINK_RE.exec(e.raw))) {
			const target = m[1].trim();
			const targetSlug = titleToSlug.get(target) ?? (slugSet.has(target) ? target : null);
			if (!targetSlug || targetSlug === e.slug) continue;
			if (!slugToReferrers.has(targetSlug)) slugToReferrers.set(targetSlug, []);
			const arr = slugToReferrers.get(targetSlug);
			if (!arr.some((r) => r.slug === e.slug)) arr.push({ title: e.title, slug: e.slug });
		}
	}

	return { titleToSlug, slugSet, slugToReferrers, slugToMeta };
}

function data(rootDir) {
	return scan(rootDir || FALLBACK_ROOT);
}

/** wikilink 目标解析：标题或 slug → slug；不存在返回 null */
export function resolveTarget(target, rootDir) {
	const { titleToSlug, slugSet } = data(rootDir);
	return titleToSlug.get(target) ?? (slugSet.has(target) ? target : null);
}

/** 某篇文章的反链列表（谁引用了我） */
export function getBacklinks(slug, rootDir) {
	const { slugToReferrers } = data(rootDir);
	return slugToReferrers.get(slug) ?? [];
}

/** 全站文章索引：slug → { title, description }（用于 wikilink 悬停预览，§5.2.4） */
export function getLinkIndex(rootDir) {
	const { slugToMeta } = data(rootDir);
	return Object.fromEntries(slugToMeta);
}
