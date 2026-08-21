/// <reference types="mdast" />
/**
 * 技术文档套件插件（§5.2.1/§5.2.2 / N10）：
 * ```api 围栏 → 接口卡片（方法徽章/路径/参数表/响应示例）
 * ```params 围栏 → 独立参数表
 * 在 remark 层拦截（Expressive Code 的 rehype 插件之前必然运行，不会误抢）。
 */
import { visit } from "unist-util-visit";

export function remarkRichBlocks() {
	return (tree) => {
		visit(tree, "code", (node, index, parent) => {
			if (!parent || index === null) return;
			if (node.lang !== "api" && node.lang !== "params") return;
			const html =
				node.lang === "api" ? renderApiBlock(node.value) : renderParamsBlock(node.value);
			parent.children.splice(index, 1, { type: "html", value: html });
		});
	};
}

/* ========== mini YAML 解析（覆盖 §5.2.1/§5.2.2 的受限语法） ========== */

function indentOf(line) {
	return line.length - line.trimStart().length;
}

/** 解析受限 YAML：顶层 key:value / key: 列表 / 列表项缩进属性 / value: | 多行 */
function parseRichYaml(src) {
	const lines = src.split("\n");
	const root = {};
	const topLists = {}; // key -> 数组（列表项为对象）
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim() || line.trim().startsWith("#")) {
			i++;
			continue;
		}
		const kv = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
		if (!kv) {
			i++;
			continue;
		}
		const [, , key, val] = kv;

		if (val === "|" || val === "|-" || val === ">") {
			// 块标量：收集更深缩进的行
			const baseIndent = indentOf(line);
			const body = [];
			i++;
			while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > baseIndent)) {
				body.push(lines[i].replace(/^\s{1,4}/, ""));
				i++;
			}
			root[key] = body.join("\n").replace(/\n+$/, "");
			continue;
		}

		if (val === "") {
			// 列表或嵌套开始
			const list = [];
			i++;
			while (i < lines.length && lines[i].trim().startsWith("- ")) {
				const itemText = lines[i].trim().slice(2);
				const itemIndent = indentOf(lines[i]);
				const item = {};
				// 列表项首属性（- name: x 形式）
				const first = itemText.match(/^([\w-]+):\s*(.*)$/);
				if (first) {
					item[first[1]] = parseScalar(first[2]);
				} else {
					item.value = parseScalar(itemText);
				}
				i++;
				// 后续缩进属性
				while (
					i < lines.length &&
					lines[i].trim() &&
					indentOf(lines[i]) > itemIndent &&
					!lines[i].trim().startsWith("- ")
				) {
					const prop = lines[i].trim().match(/^([\w-]+):\s*(.*)$/);
					if (prop) item[prop[1]] = parseScalar(prop[2]);
					i++;
				}
				list.push(item);
			}
			root[key] = list;
			topLists[key] = list;
			continue;
		}

		root[key] = parseScalar(val);
		i++;
	}
	return root;
}

function parseScalar(v) {
	const s = v.trim();
	if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
	const num = Number(s);
	if (s !== "" && !Number.isNaN(num)) return num;
	return s.replace(/^["']|["']$/g, "");
}

/* ========== HTML 渲染 ========== */

function esc(s) {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const METHOD_CLASS = {
	GET: "m-get",
	POST: "m-post",
	PUT: "m-put",
	DELETE: "m-delete",
	PATCH: "m-patch",
};

function renderApiBlock(src) {
	const d = parseRichYaml(src);
	const method = String(d.method ?? "GET").toUpperCase();
	const parts = [];

	parts.push(
		`<div class="cl-api-card">`,
		`<div class="cl-api-head"><span class="cl-api-method ${METHOD_CLASS[method] ?? "m-get"}">${esc(method)}</span><code class="cl-api-path">${esc(d.path ?? "")}</code></div>`,
	);
	if (d.summary) parts.push(`<p class="cl-api-summary">${esc(d.summary)}</p>`);

	if (Array.isArray(d.params) && d.params.length) {
		parts.push(renderParamTable(d.params, "请求参数"));
	}
	if (Array.isArray(d.responses) && d.responses.length) {
		parts.push(`<div class="cl-api-resp-title">响应</div>`);
		for (const r of d.responses) {
			const ok = Number(r.status) < 400;
			parts.push(
				`<div class="cl-api-resp"><span class="cl-status ${ok ? "ok" : "bad"}">${esc(r.status)}</span><span class="cl-api-resp-desc">${esc(r.desc ?? "")}</span></div>`,
			);
			if (r.body) {
				parts.push(`<pre class="cl-api-body"><code>${esc(r.body)}</code></pre>`);
			}
		}
	}
	parts.push(`</div>`);
	return parts.join("\n");
}

function renderParamsBlock(src) {
	const d = parseRichYaml(src);
	// params 块：顶层就是列表（- name: ...），解析器挂在首个空键下；直接扫行更稳
	const list = Array.isArray(d.params)
		? d.params
		: extractTopList(src);
	return renderParamTable(list, "参数");
}

/** params 块的列表直接从源文本提取（顶层无键名） */
function extractTopList(src) {
	const lines = src.split("\n");
	const list = [];
	let i = 0;
	while (i < lines.length) {
		if (!lines[i].trim().startsWith("- ")) {
			i++;
			continue;
		}
		const itemIndent = indentOf(lines[i]);
		const item = {};
		const first = lines[i].trim().slice(2).match(/^([\w-]+):\s*(.*)$/);
		if (first) item[first[1]] = parseScalar(first[2]);
		i++;
		while (
			i < lines.length &&
			lines[i].trim() &&
			indentOf(lines[i]) > itemIndent &&
			!lines[i].trim().startsWith("- ")
		) {
			const prop = lines[i].trim().match(/^([\w-]+):\s*(.*)$/);
			if (prop) item[prop[1]] = parseScalar(prop[2]);
			i++;
		}
		list.push(item);
	}
	return list;
}

function renderParamTable(list, title) {
	if (!Array.isArray(list) || !list.length) return "";
	const rows = list
		.map(
			(p) =>
				`<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.in ?? p.type ?? "")}</td><td>${esc(p.type ?? "")}</td><td>${p.required ? '<span class="cl-req">必填</span>' : "否"}</td><td>${esc(p.default ?? "-")}</td><td>${esc(p.desc ?? "")}</td></tr>`,
		)
		.join("");
	return (
		`<div class="cl-param-title">${esc(title)}</div>` +
		`<div class="cl-table-wrap"><table class="cl-param-table"><thead><tr><th>参数</th><th>位置</th><th>类型</th><th>必填</th><th>默认</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div>`
	);
}
