<script lang="ts">
/**
 * ⌘K 命令面板（§7 / N8）：玻璃浮层 + 分组结果（命令 / 页面）+ 键盘导航。
 * 页面组走构建期 Pagefind 索引（window.pagefind，与 Search.svelte 同源）；
 * 命令组可执行：新建笔记 / 跳设置台 / 切主题 / 回首页（类 Raycast）。
 */
import Icon from "@iconify/svelte";
import { onMount } from "svelte";
import type { SearchResult } from "@/global";

interface Command {
	id: string;
	label: string;
	hint: string;
	run: () => void;
}

let open = false;
let keyword = "";
let results: SearchResult[] = [];
let activeIndex = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let inputEl: HTMLInputElement | undefined;

const toggleTheme = () => {
	const el = document.documentElement;
	const dark = el.classList.toggle("dark");
	localStorage.setItem("theme", dark ? "dark" : "light");
};

const COMMANDS: Command[] = [
	{
		id: "new-note",
		label: "新建笔记",
		hint: "打开写作空间",
		run: () => {
			window.location.href = "/dev/write/";
		},
	},
	{
		id: "console",
		label: "打开设置控制台",
		hint: "外观 · 布局 · 内容 · 阅读 · 交互",
		run: () => {
			window.location.href = "/dev/console/";
		},
	},
	{
		id: "theme",
		label: "切换明暗主题",
		hint: "Light ↔ Dark",
		run: () => toggleTheme(),
	},
	{
		id: "home",
		label: "回到首页",
		hint: "星云展示区",
		run: () => {
			window.location.href = "/dev/";
		},
	},
];

$: kw = keyword.trim().toLowerCase();
$: filteredCommands = kw
	? COMMANDS.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(kw))
	: COMMANDS;

type FlatItem =
	| { kind: "cmd"; cmd: Command }
	| { kind: "page"; page: SearchResult };

$: flatItems = [
	...filteredCommands.map((c) => ({ kind: "cmd" as const, cmd: c })),
	...results.map((r) => ({ kind: "page" as const, page: r })),
] as FlatItem[];

const runItem = (item: FlatItem | undefined) => {
	if (!item) return;
	open = false;
	if (item.kind === "cmd") item.cmd.run();
	else window.location.href = item.page.url;
};

const searchPagefind = async (k: string) => {
	if (!k) {
		results = [];
		return;
	}
	if (!(import.meta.env.PROD && window.pagefind)) {
		results = [];
		return;
	}
	try {
		const res = await window.pagefind.search(k);
		results = (await Promise.all(res.results.slice(0, 8).map((r) => r.data()))) as SearchResult[];
	} catch {
		results = [];
	}
};

$: if (open) {
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(() => searchPagefind(keyword.trim()), 200);
	activeIndex = 0;
}

const onKeydown = (e: KeyboardEvent) => {
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
		e.preventDefault();
		open = !open;
		keyword = "";
		results = [];
		activeIndex = 0;
		if (open) setTimeout(() => inputEl?.focus(), 0);
		return;
	}
	if (!open) return;
	if (e.key === "Escape") {
		open = false;
	} else if (e.key === "ArrowDown") {
		e.preventDefault();
		activeIndex = Math.min(activeIndex + 1, flatItems.length - 1);
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		activeIndex = Math.max(activeIndex - 1, 0);
	} else if (e.key === "Enter") {
		e.preventDefault();
		runItem(flatItems[activeIndex]);
	}
};

onMount(() => {
	window.addEventListener("keydown", onKeydown);
	return () => window.removeEventListener("keydown", onKeydown);
});
</script>

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
		on:click|self={() => (open = false)}
	>
		<!-- 玻璃浮层（§10 玻璃拟态 2.0） -->
		<div
			class="w-full max-w-[34rem] rounded-2xl border border-black/10 dark:border-white/15
			bg-white/80 dark:bg-[#121a2e]/85 backdrop-blur-xl shadow-2xl overflow-hidden"
			role="dialog"
			aria-label="命令面板"
		>
			<div class="flex items-center gap-3 px-4 h-14 border-b border-black/5 dark:border-white/10">
				<Icon
					icon="material-symbols:search"
					class="text-[1.25rem] text-black/30 dark:text-white/30"
				/>
				<input
					bind:this={inputEl}
					bind:value={keyword}
					placeholder="搜索页面或执行命令…"
					class="flex-1 bg-transparent outline-0 text-sm
					text-black/80 dark:text-white/85 placeholder:text-black/30 dark:placeholder:text-white/30"
				/>
				<kbd class="hidden md:inline-block text-[0.65rem] px-1.5 py-0.5 rounded border
				border-black/10 dark:border-white/15 text-black/40 dark:text-white/40 font-mono">ESC</kbd>
			</div>

			<div class="max-h-[46vh] overflow-y-auto p-2">
				{#if flatItems.length === 0}
					<div class="py-10 text-center text-sm text-black/40 dark:text-white/40">
						{keyword ? "没有匹配的结果" : "输入关键词搜索，或选择一个命令"}
					</div>
				{/if}

				{#if filteredCommands.length > 0}
					<div class="px-3 pt-1.5 pb-1 text-[0.65rem] font-mono tracking-wider uppercase
					text-black/35 dark:text-white/35">命令</div>
					{#each filteredCommands as c, i}
						<button
							class="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition
							{activeIndex === i ? 'bg-[var(--btn-plain-bg-hover)]' : 'hover:bg-[var(--btn-plain-bg-hover)]'}"
							on:click={() => runItem({ kind: 'cmd', cmd: c })}
							on:mousemove={() => (activeIndex = i)}
						>
							<Icon icon="material-symbols:bolt" class="text-[1rem] text-[var(--primary)]" />
							<span class="text-sm font-bold text-black/80 dark:text-white/85">{c.label}</span>
							<span class="ml-auto text-xs text-black/40 dark:text-white/40">{c.hint}</span>
						</button>
					{/each}
				{/if}

				{#if results.length > 0}
					<div class="px-3 pt-3 pb-1 text-[0.65rem] font-mono tracking-wider uppercase
					text-black/35 dark:text-white/35">页面</div>
					{#each results as r, j}
						{@const idx = filteredCommands.length + j}
						<a
							href={r.url}
							class="block rounded-xl px-3 py-2.5 transition
							{activeIndex === idx ? 'bg-[var(--btn-plain-bg-hover)]' : 'hover:bg-[var(--btn-plain-bg-hover)]'}"
							on:click={() => (open = false)}
							on:mousemove={() => (activeIndex = idx)}
						>
							<div class="flex items-center gap-2 text-sm font-bold
							text-black/80 dark:text-white/85">
								<Icon icon="fa6-solid:file-lines" class="text-[0.8rem] text-[var(--primary)]" />
								{r.meta.title}
							</div>
							<div class="mt-0.5 text-xs text-black/50 dark:text-white/50 line-clamp-2">
								{@html r.excerpt}
							</div>
						</a>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
