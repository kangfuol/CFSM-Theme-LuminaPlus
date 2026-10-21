import { useLayoutEffect, useRef, type CSSProperties } from "react";

/** 气泡离裁切边缘至少留这么多，小尖角离气泡两端也至少留这么多。 */
const EDGE_GAP_PX = 4;
const ARROW_INSET_PX = 8;

/** 往上找第一个会裁掉溢出内容的祖先（卡片都是 overflow:hidden）；找不到就以视口为界。 */
function findClipRect(element: HTMLElement): { left: number; right: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== "visible") {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }
  }
  return { left: 0, right: document.documentElement.clientWidth };
}

/**
 * 延迟 / 丢包柱子上方的数值气泡，对着悬停的那根柱子弹。
 *
 * 位置按气泡的实际宽度算：原来按「气泡最宽 84px」写死夹在 42px ~ 100%-42px 之间，
 * 「07:54 - 08:00 · 33 ms」这种一百三十多像素的气泡挨着最左边的柱子时伸出卡片、被裁掉一截（站长 2026-10-21 截图）。
 * 现在量出气泡宽度，夹在最近的裁切容器里，小尖角单独挪到正对柱子的位置。
 */
export function HealthBucketTooltip({
  text,
  index,
  count,
  className = "node-health-hover-tooltip",
}: {
  text: string | null;
  index: number | null;
  count: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const visible = Boolean(text) && index != null && count > 0;
  const position = visible ? ((index! + 0.5) / count) * 100 : 50;

  useLayoutEffect(() => {
    const bubble = ref.current;
    const parent = bubble?.offsetParent;
    if (!bubble || !(parent instanceof HTMLElement) || !visible) return;
    const parentRect = parent.getBoundingClientRect();
    const clip = findClipRect(bubble);
    // offsetWidth 不受入场动画的 scale 影响，量到的是真实宽度。
    const width = bubble.offsetWidth;
    const half = width / 2;
    const center = (position / 100) * parentRect.width;
    const minCenter = clip.left - parentRect.left + EDGE_GAP_PX + half;
    const maxCenter = clip.right - parentRect.left - EDGE_GAP_PX - half;
    const left =
      minCenter <= maxCenter ? Math.min(Math.max(center, minCenter), maxCenter) : center;
    const arrow = Math.min(Math.max(center - left + half, ARROW_INSET_PX), width - ARROW_INSET_PX);
    bubble.style.left = `${left}px`;
    bubble.style.setProperty("--health-tooltip-arrow-x", `${arrow}px`);
  }, [position, text, visible]);

  if (!visible) return null;

  // 量好之前（同一帧内）先按百分比放，避免第一帧跳一下。
  const style = { left: `${position}%` } as CSSProperties;
  return (
    <span ref={ref} className={className} style={style} role="status">
      {text}
    </span>
  );
}
