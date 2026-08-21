<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import {
	getBackgroundImage,
	getBackgroundImageEnabled,
	getBgEffect,
	getDefaultHue,
	getHue,
	setBackgroundImage,
	setBackgroundImageEnabled,
	setBgEffect,
	setHue,
} from "@utils/setting-utils";

let hue = getHue();
const defaultHue = getDefaultHue();

let bgImage = getBackgroundImage();
let bgImageEnabled = getBackgroundImageEnabled();
let bgEffect = getBgEffect();

function resetHue() {
	hue = getDefaultHue();
}

$: if (hue || hue === 0) {
	setHue(hue);
}

$: if (bgEffect) {
	setBgEffect(bgEffect);
}

$: if (typeof bgImageEnabled === "boolean") {
	setBackgroundImageEnabled(bgImageEnabled);
}

function onUrlInput(e: Event) {
	bgImage = (e.target as HTMLInputElement).value;
	setBackgroundImage(bgImage);
}

function onUpload(e: Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = () => {
		bgImage = String(reader.result);
		setBackgroundImage(bgImage);
	};
	reader.readAsDataURL(file);
}

function clearBg() {
	bgImage = "";
	setBackgroundImage("");
}

const effectOptions: { key: I18nKey; value: string; icon: string }[] = [
	{ key: I18nKey.effectNone, value: "none", icon: "ph:circle-slash-bold" },
	{ key: I18nKey.effectNebula, value: "nebula", icon: "ph:planet-bold" },
	{ key: I18nKey.effectSakura, value: "sakura", icon: "ph:flower-lotus-bold" },
	{ key: I18nKey.effectSnow, value: "snow", icon: "ph:snowflake-bold" },
	{ key: I18nKey.effectFirefly, value: "firefly", icon: "ph:bug-bold" },
];
</script>

<div id="display-setting" class="float-panel float-panel-closed absolute transition-all w-96 right-4 px-4 py-4 max-h-[80vh] overflow-y-auto">
    <!-- 主题色 -->
    <div class="flex flex-row gap-2 mb-3 items-center justify-between">
        <div class="flex gap-2 font-bold text-lg text-neutral-900 dark:text-neutral-100 transition relative ml-3
            before:w-1 before:h-4 before:rounded-md before:bg-[var(--primary)]
            before:absolute before:-left-3 before:top-[0.33rem]"
        >
            {i18n(I18nKey.themeColor)}
            <button aria-label="Reset to Default" class="btn-regular w-7 h-7 rounded-md  active:scale-90 will-change-transform"
                    class:opacity-0={hue === defaultHue} class:pointer-events-none={hue === defaultHue} on:click={resetHue}>
                <div class="text-[var(--btn-content)]">
                    <Icon icon="fa6-solid:arrow-rotate-left" class="text-[0.875rem]"></Icon>
                </div>
            </button>
        </div>
        <div class="flex gap-1">
            <div id="hueValue" class="transition bg-[var(--btn-regular-bg)] w-10 h-7 rounded-md flex justify-center
            font-bold text-sm items-center text-[var(--btn-content)]">
                {hue}
            </div>
        </div>
    </div>
    <div class="w-full h-6 px-1 bg-[oklch(0.80_0.10_0)] dark:bg-[oklch(0.70_0.10_0)] rounded select-none">
        <input aria-label={i18n(I18nKey.themeColor)} type="range" min="0" max="360" bind:value={hue}
               class="slider" id="colorSlider" step="5" style="width: 100%">
    </div>

    <div class="my-4 h-px bg-neutral-200 dark:bg-neutral-700"></div>

    <!-- 背景特效（单选） -->
    <div class="flex flex-row gap-2 mb-3 items-center justify-between px-1">
        <div class="flex gap-2 font-bold text-neutral-900 dark:text-neutral-100 items-center">
            <Icon icon="ph:sparkle-bold" class="text-[1rem]"></Icon>
            {i18n(I18nKey.effect)}
        </div>
    </div>
    <div class="grid grid-cols-5 gap-2 px-1 mb-1">
        {#each effectOptions as opt}
            <label class="cursor-pointer select-none" title={i18n(opt.key)}>
                <input type="radio" class="sr-only peer" name="bg-effect" value={opt.value} bind:group={bgEffect} />
                <div class="flex flex-col items-center gap-1 rounded-md px-1 py-2
                    bg-[var(--btn-regular-bg)] text-[var(--btn-content)] transition
                    hover:bg-[var(--btn-regular-bg-hover)] cursor-pointer
                    peer-checked:ring-2 peer-checked:ring-[var(--primary)] peer-checked:text-[var(--primary)]">
                    <Icon icon={opt.icon} class="text-[1.125rem]"></Icon>
                    <span class="text-[0.7rem] leading-tight text-center">{i18n(opt.key)}</span>
                </div>
            </label>
        {/each}
    </div>

    <div class="my-4 h-px bg-neutral-200 dark:bg-neutral-700"></div>

    <!-- 背景图片 -->
    <div class="flex flex-row gap-2 mb-3 items-center justify-between px-1">
        <div class="flex gap-2 font-bold text-neutral-900 dark:text-neutral-100 items-center">
            <Icon icon="ph:image-bold" class="text-[1rem]"></Icon>
            {i18n(I18nKey.backgroundImage)}
        </div>
        <label class="flex items-center cursor-pointer select-none">
            <input type="checkbox" class="sr-only peer" bind:checked={bgImageEnabled}>
            <div class="w-10 h-5 rounded-full bg-neutral-300 dark:bg-neutral-600 peer-checked:bg-[var(--primary)]
                relative transition after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full
                after:bg-white after:transition peer-checked:after:translate-x-5"></div>
        </label>
    </div>

    <div class="flex flex-col gap-2 px-1">
        <div class="flex gap-2">
            <label class="btn-regular flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1.5 cursor-pointer
                active:scale-95 transition text-sm">
                <Icon icon="ph:upload-bold" class="text-[0.875rem]"></Icon>
                {i18n(I18nKey.uploadImage)}
                <input type="file" accept="image/*" class="hidden" on:change={onUpload} />
            </label>
            <button aria-label={i18n(I18nKey.uploadImage)} class="btn-regular flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1.5
                active:scale-95 transition text-sm" on:click={clearBg}>
                <Icon icon="ph:x-bold" class="text-[0.875rem]"></Icon>
            </button>
        </div>
        <div class="flex items-center gap-2">
            <Icon icon="ph:link-bold" class="text-[0.875rem] shrink-0"></Icon>
            <input type="text" placeholder={i18n(I18nKey.imageUrl)} value={bgImage}
                   class="w-full bg-[var(--btn-regular-bg)] rounded-md px-2 py-1.5 text-sm
                   text-[var(--btn-content)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
                   on:change={onUrlInput} />
        </div>
    </div>
</div>


<style lang="stylus">
    #display-setting
      input[type="range"]
        -webkit-appearance none
        height 1.5rem
        background-image var(--color-selection-bar)
        transition background-image 0.15s ease-in-out

        &::-webkit-slider-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-moz-range-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          border-width 0
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-ms-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

    #display-setting
      input[type="radio"].sr-only,
      input[type="checkbox"].sr-only
        position absolute
        width 1px
        height 1px
        margin -1px
        padding 0
        overflow hidden
        clip rect(0, 0, 0, 0)
        white-space nowrap
        border-width 0
</style>
