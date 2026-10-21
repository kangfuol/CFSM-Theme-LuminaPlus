import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** 鼠标按下后移动超过这个距离才算拖动；没到就是普通点击（筛选）。 */
const MOUSE_DRAG_THRESHOLD_PX = 5;
/**
 * 触屏要先长按才进入拖动：标签栏在页面中间，手指按上去一划多半是想滚动页面（分组栏还要横着滑），
 * 一碰就拖的话就滚不动了。长按期间手指挪动超过容差就当滚动、放弃拖动。
 */
const TOUCH_LONG_PRESS_MS = 320;
const TOUCH_MOVE_TOLERANCE_PX = 8;
const REORDER_ANIMATION_MS = 160;
/** 离别的位置比离自己的位置近这么多才换位：标签宽窄不一，没有这点余量会在交界处来回跳。 */
const SWAP_HYSTERESIS_PX = 6;
/** 拖完抬手后浏览器还会补一次 click，这段时间内的 click 不当筛选。 */
const CLICK_SUPPRESS_MS = 400;
/** 能横向滚动的标签栏（分组栏）：拖到离边缘这么近就顺着滚，每次指针移动滚这么多。 */
const EDGE_SCROLL_ZONE_PX = 28;
const EDGE_SCROLL_STEP_PX = 10;

interface PendingPress {
  code: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  /** 按下的位置相对标签左上角的偏移：拖动时标签跟着指针走，抓哪儿就一直是哪儿。 */
  grabX: number;
  grabY: number;
  timer: number | null;
}

interface ActiveDrag {
  code: string;
  pointerId: number;
  grabX: number;
  grabY: number;
  x: number;
  y: number;
}

type Point = { left: number; top: number };

function moveItem(list: readonly string[], from: number, to: number): string[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

/** 拖动途中选项变了（全量同步增删了节点）：还在的保持拖动中的顺序，新出现的接在后面。 */
function reconcileOrder(order: readonly string[], codes: readonly string[]): string[] {
  const available = new Set(codes);
  const kept = order.filter((code) => available.has(code));
  const keptSet = new Set(kept);
  return [...kept, ...codes.filter((code) => !keptSet.has(code))];
}

/**
 * 首页标签栏直接拖动排序（地区栏、分组栏共用）：鼠标按住拖，触屏长按再拖。
 *
 * 拖动中只改这里的预览顺序，抬手才交给 `onReorder` 存；Esc 或浏览器中断拖动（pointercancel）就退回原顺序。
 * 换位按「拖动中的标签中心离哪个标签最近」算（地区栏会换行，所以是二维距离），别的标签用 FLIP 滑到新位置。
 * 位置都按容器内的布局坐标（offsetLeft 减去容器滚动量）算，所以能横向滚动的分组栏也对得上。
 */
export function useDragReorder({
  codes,
  onReorder,
}: {
  /** 当前显示的顺序（就是存下来的顺序）。 */
  codes: readonly string[];
  /** 拖完、且顺序真的变了才调，参数是拖完后的全部代码；不传就不能拖。 */
  onReorder?: (codes: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const [draggingCode, setDraggingCode] = useState<string | null>(null);
  const suppressClickUntilRef = useRef(0);
  /** 换位前各标签在屏幕上的位置；换位渲染完据此把它们从旧位置滑过去（FLIP）。 */
  const flipFromRef = useRef<Map<string, Point> | null>(null);

  const order = useMemo(
    () => (previewOrder ? reconcileOrder(previewOrder, codes) : [...codes]),
    [previewOrder, codes],
  );

  // 指针事件挂在 window 上、只在按下时装一次，读到的必须是最新值，所以经 ref 转一道。
  const latestRef = useRef({ order, codes, onReorder });
  useLayoutEffect(() => {
    latestRef.current = { order, codes, onReorder };
  });

  const controller = useMemo(() => {
    let pending: PendingPress | null = null;
    let drag: ActiveDrag | null = null;

    const visualPositions = () => {
      const positions = new Map<string, Point>();
      for (const [code, el] of itemRefs.current) {
        const rect = el.getBoundingClientRect();
        positions.set(code, { left: rect.left, top: rect.top });
      }
      return positions;
    };

    /** 容器内容区左上角在屏幕上的位置（扣掉边框和滚动量），加上 offsetLeft / offsetTop 就是标签的布局位置。 */
    const contentOrigin = (container: HTMLElement) => {
      const box = container.getBoundingClientRect();
      return {
        x: box.left + container.clientLeft - container.scrollLeft,
        y: box.top + container.clientTop - container.scrollTop,
      };
    };

    /** 拖动中的标签贴着指针：布局位置（offsetLeft，不受 transform 影响）和指针之间差多少就平移多少。 */
    const positionDragged = () => {
      const container = containerRef.current;
      const el = drag ? itemRefs.current.get(drag.code) : undefined;
      if (!drag || !container || !el) return;
      const origin = contentOrigin(container);
      const dx = drag.x - drag.grabX - (origin.x + el.offsetLeft);
      const dy = drag.y - drag.grabY - (origin.y + el.offsetTop);
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    /** 能横向滚动的栏：拖到边上就顺着滚一点，不然够不着看不见的那几个位置。 */
    const scrollNearEdge = () => {
      const container = containerRef.current;
      if (!drag || !container || container.scrollWidth <= container.clientWidth) return;
      const box = container.getBoundingClientRect();
      if (drag.x < box.left + EDGE_SCROLL_ZONE_PX) container.scrollLeft -= EDGE_SCROLL_STEP_PX;
      else if (drag.x > box.right - EDGE_SCROLL_ZONE_PX) container.scrollLeft += EDGE_SCROLL_STEP_PX;
    };

    /** 拖动中的标签中心离哪个标签的位置最近，就挪到那个位置。 */
    const updateTarget = () => {
      const container = containerRef.current;
      const el = drag ? itemRefs.current.get(drag.code) : undefined;
      if (!drag || !container || !el) return;
      const current = latestRef.current.order;
      const from = current.indexOf(drag.code);
      if (from === -1) return;

      const origin = contentOrigin(container);
      const centerX = drag.x - drag.grabX + el.offsetWidth / 2;
      const centerY = drag.y - drag.grabY + el.offsetHeight / 2;
      const distanceTo = (item: HTMLElement) =>
        Math.hypot(
          centerX - (origin.x + item.offsetLeft + item.offsetWidth / 2),
          centerY - (origin.y + item.offsetTop + item.offsetHeight / 2),
        );

      const ownDistance = distanceTo(el);
      let target = from;
      let best = ownDistance;
      current.forEach((code, index) => {
        if (index === from) return;
        const item = itemRefs.current.get(code);
        if (!item) return;
        const distance = distanceTo(item);
        if (distance + SWAP_HYSTERESIS_PX < ownDistance && distance < best) {
          target = index;
          best = distance;
        }
      });
      if (target === from) return;
      flipFromRef.current = visualPositions();
      setPreviewOrder(moveItem(current, from, target));
    };

    const beginDrag = (press: PendingPress, x: number, y: number) => {
      if (press.timer != null) window.clearTimeout(press.timer);
      pending = null;
      drag = {
        code: press.code,
        pointerId: press.pointerId,
        grabX: press.grabX,
        grabY: press.grabY,
        x,
        y,
      };
      const el = itemRefs.current.get(press.code);
      // 拖动中位置每帧都在变，不能带过渡；松手时再加回来让它滑回格子里。
      if (el) el.style.transition = "none";
      window.getSelection()?.removeAllRanges();
      setDraggingCode(press.code);
      setPreviewOrder([...latestRef.current.order]);
      positionDragged();
    };

    const detach = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };

    const finishDrag = (commit: boolean) => {
      const active = drag;
      drag = null;
      detach();
      if (!active) return;

      const el = itemRefs.current.get(active.code);
      if (el) {
        el.style.transition = `transform ${REORDER_ANIMATION_MS}ms ease`;
        el.style.transform = "";
        window.setTimeout(() => {
          if (drag?.code !== active.code) el.style.transition = "";
        }, REORDER_ANIMATION_MS);
      }
      suppressClickUntilRef.current = performance.now() + CLICK_SUPPRESS_MS;
      setDraggingCode(null);

      const { order: finalOrder, codes: savedOrder, onReorder: save } = latestRef.current;
      if (commit && !sameOrder(finalOrder, savedOrder)) {
        // 上层同步写进设置，这一拍 codes 就是新顺序，和清掉预览一起渲染，不会闪回旧顺序。
        save?.(finalOrder);
      } else if (!sameOrder(finalOrder, savedOrder)) {
        flipFromRef.current = visualPositions();
      }
      setPreviewOrder(null);
    };

    const cancelPending = () => {
      if (pending?.timer != null) window.clearTimeout(pending.timer);
      pending = null;
    };

    function handleMove(event: PointerEvent) {
      if (drag) {
        if (event.pointerId !== drag.pointerId) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        scrollNearEdge();
        positionDragged();
        updateTarget();
        return;
      }
      if (!pending || event.pointerId !== pending.pointerId) return;
      const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (pending.pointerType === "mouse") {
        if (moved > MOUSE_DRAG_THRESHOLD_PX) beginDrag(pending, event.clientX, event.clientY);
      } else if (moved > TOUCH_MOVE_TOLERANCE_PX) {
        // 长按还没到就挪了：这是在滚动，放手让浏览器处理。
        cancelPending();
        detach();
      }
    }

    function handleUp(event: PointerEvent) {
      if (drag) {
        if (event.pointerId === drag.pointerId) finishDrag(true);
        return;
      }
      if (pending && event.pointerId === pending.pointerId) {
        cancelPending();
        detach();
      }
    }

    function handleCancel(event: PointerEvent) {
      if (drag) {
        if (event.pointerId === drag.pointerId) finishDrag(false);
        return;
      }
      if (pending && event.pointerId === pending.pointerId) {
        cancelPending();
        detach();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && drag) finishDrag(false);
    }

    return {
      isDragging: () => drag != null,
      isPressing: () => drag != null || pending != null,
      pointerDown(event: ReactPointerEvent<HTMLElement>, code: string) {
        if (!latestRef.current.onReorder || latestRef.current.codes.length < 2) return;
        if (drag) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        cancelPending();
        detach();
        const rect = event.currentTarget.getBoundingClientRect();
        const press: PendingPress = {
          code,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          grabX: event.clientX - rect.left,
          grabY: event.clientY - rect.top,
          timer: null,
        };
        if (event.pointerType !== "mouse") {
          press.timer = window.setTimeout(
            () => beginDrag(press, press.startX, press.startY),
            TOUCH_LONG_PRESS_MS,
          );
        }
        pending = press;
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleCancel);
        window.addEventListener("keydown", handleKeyDown);
      },
      positionDragged,
      dispose() {
        cancelPending();
        drag = null;
        detach();
      },
    };
  }, []);

  useEffect(() => () => controller.dispose(), [controller]);

  // 触屏拖动时拦住页面滚动。必须是非被动监听、而且一直挂着：等长按到了再挂，这一次触摸
  // 的滚动已经由浏览器接管了。只拦「正在拖」的那段，长按还没到时照常滚动。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const blockScroll = (event: TouchEvent) => {
      if (controller.isDragging()) event.preventDefault();
    };
    container.addEventListener("touchmove", blockScroll, { passive: false });
    return () => container.removeEventListener("touchmove", blockScroll);
  }, [controller]);

  // 换位之后：别的标签从旧位置滑到新位置，拖动中的标签重新贴回指针。
  useLayoutEffect(() => {
    const from = flipFromRef.current;
    flipFromRef.current = null;
    if (from) {
      for (const [code, el] of itemRefs.current) {
        if (code === draggingCode) continue;
        const before = from.get(code);
        if (!before) continue;
        el.style.transition = "none";
        el.style.transform = "";
        const after = el.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (dx === 0 && dy === 0) {
          el.style.transition = "";
          continue;
        }
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        // 先让浏览器按旧位置排一次，下面清掉 transform 才会有过渡。
        void el.offsetWidth;
        el.style.transition = `transform ${REORDER_ANIMATION_MS}ms ease`;
        el.style.transform = "";
        window.setTimeout(() => {
          if (el.style.transform === "") el.style.transition = "";
        }, REORDER_ANIMATION_MS);
      }
    }
    controller.positionDragged();
  }, [order, draggingCode, controller]);

  const itemRef = useCallback(
    (code: string) => (el: HTMLElement | null) => {
      if (el) itemRefs.current.set(code, el);
      else itemRefs.current.delete(code);
    },
    [],
  );

  /** 挂到每个可拖的标签上：按下开始判定拖动；拦原生拖图片和长按菜单。 */
  const itemHandlers = useCallback(
    (code: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => controller.pointerDown(event, code),
      // 国旗是 <img>：不拦的话鼠标一拖就变成浏览器原生的拖图片。
      onDragStart: (event: { preventDefault: () => void }) => event.preventDefault(),
      // 安卓长按按钮可能弹菜单，正在按着 / 拖着时不要它。
      onContextMenu: (event: { preventDefault: () => void }) => {
        if (controller.isPressing()) event.preventDefault();
      },
    }),
    [controller],
  );

  /** 刚拖完抬手时浏览器补的那次 click 不当筛选。 */
  const shouldIgnoreClick = useCallback(
    () => performance.now() < suppressClickUntilRef.current,
    [],
  );

  return { containerRef, order, draggingCode, itemRef, itemHandlers, shouldIgnoreClick };
}
