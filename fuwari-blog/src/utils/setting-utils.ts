import {
	AUTO_MODE,
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
} from "@constants/constants.ts";
import { expressiveCodeConfig } from "@/config";
import type { LIGHT_DARK_MODE } from "@/types/config";

export function getDefaultHue(): number {
	const fallback = "250";
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseInt(configCarrier?.dataset.hue || fallback, 10);
}

export function getHue(): number {
	const stored = localStorage.getItem("hue");
	return stored ? Number.parseInt(stored, 10) : getDefaultHue();
}

export function setHue(hue: number): void {
	localStorage.setItem("hue", String(hue));
	const r = document.querySelector(":root") as HTMLElement;
	if (!r) {
		return;
	}
	r.style.setProperty("--hue", String(hue));
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE) {
	switch (theme) {
		case LIGHT_MODE:
			document.documentElement.classList.remove("dark");
			break;
		case DARK_MODE:
			document.documentElement.classList.add("dark");
			break;
		case AUTO_MODE:
			if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
				document.documentElement.classList.add("dark");
			} else {
				document.documentElement.classList.remove("dark");
			}
			break;
	}

	// Set the theme for Expressive Code
	document.documentElement.setAttribute(
		"data-theme",
		expressiveCodeConfig.theme,
	);
}

export function setTheme(theme: LIGHT_DARK_MODE): void {
	localStorage.setItem("theme", theme);
	applyThemeToDocument(theme);
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	return (localStorage.getItem("theme") as LIGHT_DARK_MODE) || DEFAULT_THEME;
}

/* ========== 背景图片设置 ========== */

export function getBackgroundImage(): string {
	return localStorage.getItem("bg-image") || "";
}

export function setBackgroundImage(url: string): void {
	localStorage.setItem("bg-image", url);
	applyBackgroundImage(url);
}

export function getBackgroundImageEnabled(): boolean {
	// 默认启用内置渐变背景（新访客直接有好看背景）
	return localStorage.getItem("bg-image-enabled") !== "false";
}

export function setBackgroundImageEnabled(enabled: boolean): void {
	localStorage.setItem("bg-image-enabled", String(enabled));
	applyBackgroundImage(getBackgroundImage());
}

/**
 * 将背景应用到 body：
 * - url 非空且启用 → 显示自定义图片
 * - url 为空且启用 → 显示内置默认渐变背景（CSS 变量 --bg-image-default 由样式提供）
 * - 未启用 → 全部清除（回到 page-bg 纯色）
 */
export function applyBackgroundImage(url: string, enabled = true): void {
	const body = document.body;
	if (!body) return;
	if (enabled) {
		if (url) {
			body.style.setProperty("--bg-image-url", `url("${url}")`);
			body.style.setProperty("--bg-image-default", "1");
		} else {
			body.style.removeProperty("--bg-image-url");
			body.style.setProperty("--bg-image-default", "1");
		}
		body.style.setProperty("--bg-image-enabled", "1");
	} else {
		body.style.removeProperty("--bg-image-url");
		body.style.removeProperty("--bg-image-default");
		body.style.removeProperty("--bg-image-enabled");
	}
}

export function loadBackgroundImage(): void {
	applyBackgroundImage(getBackgroundImage(), getBackgroundImageEnabled());
}

/* ========== 背景特效（单选，一次只能开一个） ========== */

export type BgEffect = "none" | "nebula" | "sakura" | "snow" | "firefly";

const BG_EFFECTS: BgEffect[] = ["none", "nebula", "sakura", "snow", "firefly"];

/** 读取当前特效。向后兼容旧的 nebula-enabled/sakura-enabled 开关。 */
export function getBgEffect(): BgEffect {
	const stored = localStorage.getItem("bg-effect") as BgEffect | null;
	if (stored && BG_EFFECTS.includes(stored)) return stored;

	// 旧设置迁移：曾单独开启过樱花 → 樱花；否则默认樱花（与浅色主题协调、可见性强）
	const oldSakura = localStorage.getItem("sakura-enabled");
	if (oldSakura === "true") return "sakura";
	return "sakura";
}

export function setBgEffect(effect: BgEffect): void {
	localStorage.setItem("bg-effect", effect);
	window.dispatchEvent(new Event("cloudletter:effect-change"));
}

/** 供特效组件判断自己是否应渲染 */
export function isEffectActive(effect: BgEffect): boolean {
	return getBgEffect() === effect;
}
