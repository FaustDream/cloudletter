import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "云笺集",
	subtitle: "以文字与代码，记录生活与思考",
	lang: "zh_CN", // Language code, e.g. 'en', 'zh_CN', 'ja', etc.
	themeColor: {
		hue: 9, // 朱砂红 #C2402A
		fixed: true, // 固定主题色，不让访客改
	},
	banner: {
		enable: false,
		src: "assets/images/demo-banner.png", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
		position: "center", // Equivalent to object-position, only supports 'top', 'center', 'bottom'. 'center' by default
		credit: {
			enable: false, // Display the credit text of the banner image
			text: "", // Credit text to be displayed
			url: "", // (Optional) URL link to the original artwork or artist's page
		},
	},
	toc: {
		enable: true, // Display the table of contents on the right side of the post
		depth: 2, // Maximum heading depth to show in the table, from 1 to 3
	},
	favicon: [
		// Leave this array empty to use the default favicon
		// {
		//   src: '/favicon/icon.png',    // Path of the favicon, relative to the /public directory
		//   theme: 'light',              // (Optional) Either 'light' or 'dark', set only if you have different favicons for light and dark mode
		//   sizes: '32x32',              // (Optional) Size of the favicon, set only if you have favicons of different sizes
		// }
	],
	// 可选：Umami 隐私分析（https://umami.is）。配置后仅在生产构建注入脚本。
	// 通过环境变量覆盖：UMAMI_URL（脚本地址，默认 https://analytics.umami.is/script.js）、UMAMI_WEBSITE_ID、UMAMI_ENABLED
	umami: {
		enable: import.meta.env.UMAMI_ENABLED === "true",
		// 脚本地址（含 /script.js 结尾）。自托管时改为你的域名，如 https://stats.example.com/script.js
		src: import.meta.env.UMAMI_URL || "https://analytics.umami.is/script.js",
		// Umami 后台该站点的 website id（必填，否则不注入）
		websiteId: import.meta.env.UMAMI_WEBSITE_ID || "",
	},
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.About,
		{
			name: "管理",
			url: "/dev/admin/",
			external: true,
		},
	],
};

export const profileConfig: ProfileConfig = {
	name: "Lynn",
	bio: "写代码，记录生活与思考",
	links: [
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/lynn",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: false,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	// Note: Some styles (such as background color) are being overridden, see the astro.config.mjs file.
	// Please select a dark theme, as this blog theme currently only supports dark background color
	theme: "github-dark",
};
