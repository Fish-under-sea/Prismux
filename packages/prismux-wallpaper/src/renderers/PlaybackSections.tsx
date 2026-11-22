import {
  FPS_CAP_VALUES,
  LIVE_BOOT_DELAY_VALUES,
  OBJECT_FIT_VALUES,
  PLAYBACK_RATE_VALUES,
  SCENE_LIVE_FPS_VALUES,
} from "../defaults.js";
import type { WallpaperStore } from "../store.js";
import { useWallpaperStore } from "../store.js";
import type { ObjectFitMode, RenderSurface } from "../types.js";
import { CtlText, SectionHead, SliderRow, SwitchRow } from "./controls.js";

const OBJECT_FIT_LABELS: Record<ObjectFitMode, string> = {
  cover: "铺满",
  contain: "完整",
  center: "居中",
  fill: "拉伸",
};

export interface PlaybackEffectsSectionProps {
  store: WallpaperStore;
  surface: RenderSurface;
  onPickWallpaper?: () => void;
}

/**
 * Shared Playback / Visual Effects renderer (100% reused by QuickPanel & WallpaperSettingsView).
 */
export function PlaybackEffectsSection({
  store,
  surface,
  onPickWallpaper,
}: PlaybackEffectsSectionProps) {
  const snap = useWallpaperStore(store);
  const { settings, wallpapers } = snap;
  const sidebarSurface = surface === "sidebar";
  const current = wallpapers.find((w) => w.id === settings.selectedId) ?? null;

  if (!current) {
    return (
      <div className="pmx-wp-empty">
        <span className="pmx-wp-empty__title">还没有启用壁纸</span>
        <span className="pmx-wp-hint">
          选择一款壁纸后，可在这里调整取景、滤镜、实时帧率、倍速与省电策略
        </span>
        {onPickWallpaper ? (
          <button
            type="button"
            className="pmx-wp-btn pmx-wp-btn--primary"
            onClick={onPickWallpaper}
          >
            {sidebarSurface ? "去挑一张 ›" : "选择壁纸"}
          </button>
        ) : null}
      </div>
    );
  }

  const isLiveType = current.type === "scene" || current.type === "web";
  const framingDirty =
    settings.layerPositionX !== 50 ||
    settings.layerPositionY !== 50 ||
    settings.layerScale !== 100 ||
    settings.flipX ||
    settings.flipY;

  return (
    <div className="pmx-wp-section" data-pmx-section="playback">
      <SectionHead
        label="画面与播放"
        resetModule="playback"
        onResetModule={() => store.resetModule("playback")}
      />

      {/* 画面滤镜 */}
      <SliderRow
        label="壁纸模糊"
        min={0}
        max={60}
        step={1}
        value={settings.wallpaperBlur}
        unit="px"
        onChange={(v) => store.setSetting("wallpaperBlur", v)}
      />
      <SliderRow
        label="亮度"
        min={40}
        max={160}
        step={5}
        value={settings.backgroundBrightness}
        unit="%"
        onChange={(v) => store.setSetting("backgroundBrightness", v)}
      />
      <SliderRow
        label="对比度"
        min={40}
        max={200}
        step={5}
        value={settings.backgroundContrast}
        unit="%"
        onChange={(v) => store.setSetting("backgroundContrast", v)}
      />
      <SliderRow
        label="饱和度"
        min={0}
        max={200}
        step={5}
        value={settings.backgroundSaturate}
        unit="%"
        onChange={(v) => store.setSetting("backgroundSaturate", v)}
      />

      {/* 取景偏移与缩放（双击标签单独回中 / 一键重置取景）*/}
      <SliderRow
        label="水平"
        min={0}
        max={100}
        step={1}
        value={settings.layerPositionX}
        unit="%"
        numberEdit
        tooltip="水平取景偏移：50 = 居中；双击标签复位"
        onLabelDoubleClick={() => store.setSetting("layerPositionX", 50)}
        onChange={(v) => store.setSetting("layerPositionX", v)}
      />
      <SliderRow
        label="垂直"
        min={0}
        max={100}
        step={1}
        value={settings.layerPositionY}
        unit="%"
        numberEdit
        tooltip="垂直取景偏移：50 = 居中；双击标签复位"
        onLabelDoubleClick={() => store.setSetting("layerPositionY", 50)}
        onChange={(v) => store.setSetting("layerPositionY", v)}
      />
      <SliderRow
        label="缩放"
        min={50}
        max={150}
        step={1}
        value={settings.layerScale}
        unit="%"
        numberEdit
        tooltip="100 = 原始大小；双击标签回 100%"
        onLabelDoubleClick={() => store.setSetting("layerScale", 100)}
        onChange={(v) => store.setSetting("layerScale", v)}
      />
      {framingDirty ? (
        <div className="pmx-wp-ctl">
          <span className="pmx-wp-hint">取景参数已调整</span>
          <button
            type="button"
            className="pmx-wp-btn pmx-wp-btn--mini"
            onClick={() =>
              store.updateSettings({
                layerPositionX: 50,
                layerPositionY: 50,
                layerScale: 100,
                flipX: false,
                flipY: false,
              })
            }
          >
            重置取景
          </button>
        </div>
      ) : null}

      <SliderRow
        label="壁纸透明度"
        min={0}
        max={90}
        step={5}
        value={settings.wallpaperOpacity}
        unit="%"
        tooltip="壁纸向原生主题底色淡出（浅色纯白 / 深色深蓝）"
        onChange={(v) => store.setSetting("wallpaperOpacity", v)}
      />
      <SliderRow
        label="暗化"
        min={0}
        max={90}
        step={5}
        value={Math.round(settings.scrim * 100)}
        unit="%"
        tooltip="在壁纸之上叠加柔和暗幕以增强前景对比度"
        onChange={(pct) => store.setSetting("scrim", pct / 100)}
      />

      {/* 适配与翻转 */}
      <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
        <CtlText label="画面适配" />
        <div className="pmx-wp-seg">
          {OBJECT_FIT_VALUES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={
                "pmx-wp-btn pmx-wp-rate" +
                (settings.objectFit === mode ? " pmx-wp-rate--active" : "")
              }
              aria-pressed={settings.objectFit === mode}
              onClick={() => store.setSetting("objectFit", mode)}
            >
              {OBJECT_FIT_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
        <CtlText label="画面翻转" />
        <div className="pmx-wp-seg">
          <button
            type="button"
            className={
              "pmx-wp-btn pmx-wp-rate" + (settings.flipX ? " pmx-wp-rate--active" : "")
            }
            aria-pressed={settings.flipX}
            onClick={() => store.setSetting("flipX", !settings.flipX)}
          >
            水平翻转
          </button>
          <button
            type="button"
            className={
              "pmx-wp-btn pmx-wp-rate" + (settings.flipY ? " pmx-wp-rate--active" : "")
            }
            aria-pressed={settings.flipY}
            onClick={() => store.setSetting("flipY", !settings.flipY)}
          >
            垂直翻转
          </button>
        </div>
      </div>

      {/* 播放倍速（视频壁纸） */}
      {current.type === "video" ? (
        <>
          <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
            <CtlText label="播放倍速" />
            <div className="pmx-wp-seg">
              {PLAYBACK_RATE_VALUES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={
                    "pmx-wp-btn pmx-wp-rate" +
                    (settings.playbackRate === rate ? " pmx-wp-rate--active" : "")
                  }
                  aria-pressed={settings.playbackRate === rate}
                  onClick={() => store.setSetting("playbackRate", rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>

          {/* 帧率上限仅设置页渲染（与 dsh-wallpaper-engine `!sidebarSurface` 门控一致）*/}
          {!sidebarSurface ? (
            <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
              <CtlText label="视频帧率上限" hint="限制高帧视频解码功耗" />
              <div className="pmx-wp-seg">
                {FPS_CAP_VALUES.map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    className={
                      "pmx-wp-btn pmx-wp-rate" +
                      (settings.fpsCap === cap ? " pmx-wp-rate--active" : "")
                    }
                    aria-pressed={settings.fpsCap === cap}
                    onClick={() => store.setSetting("fpsCap", cap)}
                  >
                    {cap === 0 ? "无限制" : `${cap}fps`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* 实时渲染控制（Scene / Web）*/}
      {isLiveType ? (
        <>
          <SwitchRow
            label={current.type === "web" ? "网页实时渲染" : "场景实时渲染"}
            checked={settings.sceneLive}
            hint="WebWallGL 实时渲染 · 异常自动降级绝不黑屏"
            onChange={(on) => store.setSetting("sceneLive", on)}
          />
          {settings.sceneLive ? (
            <>
              <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
                <CtlText label="实时渲染帧率" hint="越低越省电" />
                <div className="pmx-wp-seg">
                  {SCENE_LIVE_FPS_VALUES.map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      className={
                        "pmx-wp-btn pmx-wp-rate" +
                        (settings.sceneLiveFps === fps ? " pmx-wp-rate--active" : "")
                      }
                      aria-pressed={settings.sceneLiveFps === fps}
                      onClick={() => store.setSetting("sceneLiveFps", fps)}
                    >
                      {fps}fps
                    </button>
                  ))}
                </div>
              </div>

              <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
                <CtlText label="启动最长等待时间" />
                <div className="pmx-wp-seg">
                  {LIVE_BOOT_DELAY_VALUES.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      className={
                        "pmx-wp-btn pmx-wp-rate" +
                        (settings.liveBootDelay === sec ? " pmx-wp-rate--active" : "")
                      }
                      aria-pressed={settings.liveBootDelay === sec}
                      onClick={() => store.setSetting("liveBootDelay", sec)}
                    >
                      {sec === 0 ? "立即" : `≤${sec}s`}
                    </button>
                  ))}
                </div>
              </div>

              <SwitchRow
                label="自动画质"
                checked={settings.sceneAutoQuality}
                hint="帧率不足时自动降低后处理以保流畅"
                onChange={(on) => store.setSetting("sceneAutoQuality", on)}
              />
              <SwitchRow
                label="软件渲染时暂停实时渲染"
                checked={settings.sceneSoftRenderPause}
                hint="无 GPU 加速时定格首帧避免吃满 CPU"
                onChange={(on) => store.setSetting("sceneSoftRenderPause", on)}
              />
            </>
          ) : null}
        </>
      ) : null}

      {/* 省电与自动暂停 */}
      <SwitchRow
        label="遮挡 / 最小化自动暂停"
        checked={settings.pauseOnHidden}
        hint="窗口被遮挡或最小化时立即 0 FPS 挂起"
        onChange={(on) => store.setSetting("pauseOnHidden", on)}
      />
      <SwitchRow
        label="窗口失焦时暂停"
        checked={settings.pauseOnBlur}
        hint="切到其他应用时暂停渲染"
        onChange={(on) => store.setSetting("pauseOnBlur", on)}
      />
      <SwitchRow
        label="系统音频微律动"
        checked={settings.audioReactive}
        hint="随系统音频能量触发柔和光波脉动（0 Token）"
        onChange={(on) => store.setSetting("audioReactive", on)}
      />
    </div>
  );
}

export interface PlaybackAudioSectionProps {
  store: WallpaperStore;
}

/**
 * Shared Audio section rendered both in QuickPanel (bottom of Wallpaper tab + Playback tab) and SettingsView.
 */
export function PlaybackAudioSection({ store }: PlaybackAudioSectionProps) {
  const snap = useWallpaperStore(store);
  const { settings } = snap;

  return (
    <div className="pmx-wp-section" data-pmx-section="audio">
      <SectionHead label="声音" />
      <SliderRow
        label="音量"
        min={0}
        max={100}
        step={5}
        value={Math.round((settings.videoVolume || 0) * 100)}
        unit="%"
        onChange={(pct) => store.setVideoVolume(pct / 100)}
      />
      <SwitchRow
        label="壁纸音轨"
        checked={settings.videoAudioEnabled}
        hint="关闭=静音（保留音量数值）· 开启时音量 0 自动提至 50%"
        onChange={() => store.toggleAudio()}
      />
    </div>
  );
}
