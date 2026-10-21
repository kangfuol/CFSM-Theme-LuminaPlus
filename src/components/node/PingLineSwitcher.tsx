import { t } from "@/i18n";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, RotateCcw } from "lucide-react";
import {
  useAvailablePingTaskIds,
  useNodePingLineOverrides,
  useSelectedTaskId,
  useSiteSelectedTaskId,
} from "@/hooks/usePingOverview";
import { useCarrierNames } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { CARRIER_TASKS, carrierTaskName } from "@/services/cfsm/mappers";
import { setPingLineOverrides } from "@/services/pingLineOverrideStore";
import {
  nodePingLineOverrides,
  resolveNodePingLineTaskIds,
  singleLineOverride,
  switchPingLine,
  withoutMultiLineOverrides,
  withSingleLineOverride,
  type PingLineOverrides,
} from "@/utils/pingLineOverrides";

/** 浮层和线路名之间的空隙，与实例切换器 / 排序浮层的 `calc(100% + 6px)` 一致。 */
const PANEL_GAP_PX = 6;
/** 浮层离视口边缘至少留这么多：手机上贴边的卡片不能把菜单挤出屏幕。 */
const VIEWPORT_MARGIN_PX = 8;

/** 多线路的第几行，或单线路那一行（单线路模式的大卡 / 小卡、迷你卡、列表）。 */
export type PingLineSlot = number | "single";

/**
 * 卡片上的线路名：点开给这台节点的这一行换一条线路。
 *
 * 换的先存本机、逐节点逐行记（`pingLineOverrideStore`）；登录站长到设置页点「保存到后端」才会并进
 * 站点配置（`homepagePingLineOverrides`）、对所有访客生效。换线路本身不发任何请求 ——
 * 首页缓冲区里每个样本本来就带着全部线路的值，换的只是「画哪一条」。
 * 菜单本体只在打开时挂载：首页几十张卡 × 几行，平时每行只是一颗按钮，不订阅设置和缓冲区。
 */
export function PingLineSwitcher({
  uuid,
  slot,
  taskName,
  className = "multi-ping-name multi-ping-name-trigger",
}: {
  uuid: string;
  slot: PingLineSlot;
  taskName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("switcher.rowLabel", { task: taskName })}
        title={t("switcher.title")}
        onClick={(event) => {
          // 列表视图整行是 <Link>、迷你卡也可点进详情页：点线路名只开菜单，不跳页面。
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className="multi-ping-name-text">{taskName}</span>
      </button>
      {open && (
        <PingLineMenu
          id={panelId}
          uuid={uuid}
          slot={slot}
          triggerRef={triggerRef}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * 单线路时跟在「延迟」后面的线路名，点开同样能换线路（站长 2026-10-21，issue #9：关掉三网详情后
 * 只剩一条线路，看不出这个延迟是哪条线路的）。单线路模式的大卡 / 小卡、以及一直只画一条的迷你卡、列表都用它。
 */
export function SingleLineName({ uuid }: { uuid: string }) {
  const taskId = useSelectedTaskId(uuid);
  const carrierNames = useCarrierNames();
  return (
    <span className="single-ping-line">
      <span className="single-ping-sep" aria-hidden>
        ·
      </span>
      <PingLineSwitcher
        uuid={uuid}
        slot="single"
        taskName={carrierTaskName(taskId, carrierNames)}
        className="multi-ping-name-trigger single-ping-name"
      />
    </span>
  );
}

function PingLineMenu({
  id,
  uuid,
  slot,
  triggerRef,
  onClose,
}: {
  id: string;
  uuid: string;
  slot: PingLineSlot;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { homepageMultiPingTaskIds, homepagePingLineOverrides } = useThemeSettings();
  const overrides = useNodePingLineOverrides(uuid);
  const available = useAvailablePingTaskIds(uuid);
  const carrierNames = useCarrierNames();
  const singleDefault = useSiteSelectedTaskId(uuid);
  const single = slot === "single";
  // 这台节点的「默认」= 站点线路表 + 站长存到后端的逐节点换线；本机换的行相对它记，「恢复默认」也回到它。
  // 单线路时只有一行：默认是「逐节点指定 / 默认线路」（站长换过的优先），见 useSiteSelectedTaskId。
  const nodeDefault = single
    ? [singleDefault]
    : resolveNodePingLineTaskIds(
        homepageMultiPingTaskIds,
        nodePingLineOverrides(homepagePingLineOverrides, uuid),
      );
  const localSingle = singleLineOverride(overrides);
  const displayed = single
    ? [localSingle ?? singleDefault]
    : resolveNodePingLineTaskIds(nodeDefault, overrides);
  const currentTaskId = displayed[single ? 0 : slot];
  // 有数据的线路才列（后端对没配探测目标的槽位下发 false，换过去只会是一行「无样本」）；
  // 正在显示的几条哪怕暂时没数据也列上，否则找不到当前选中项，也没法把它换回来。
  const options = CARRIER_TASKS.filter(
    (task) => available.includes(task.id) || displayed.includes(task.id),
  ).map((task) => task.id);
  // 没有生效的本机覆盖时 resolve 原样返回默认那份数组，引用不同就说明本机换过。
  const customized = single
    ? localSingle != null && localSingle !== singleDefault
    : displayed !== nodeDefault;

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    // 挂在 body 上、fixed 定位：卡片有 overflow:hidden 和 content-visibility:auto，放卡内会被裁掉。
    const anchor = trigger.getBoundingClientRect();
    panel.style.maxHeight = "";
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const roomBelow = window.innerHeight - anchor.bottom - PANEL_GAP_PX - VIEWPORT_MARGIN_PX;
    const roomAbove = anchor.top - PANEL_GAP_PX - VIEWPORT_MARGIN_PX;
    // 下面放得下就往下；放不下、且上面更宽裕才翻上去（线路行在卡片底部，靠近屏幕底边很常见）。
    const above = height > roomBelow && roomAbove > roomBelow;
    const room = Math.max(0, above ? roomAbove : roomBelow);
    const shownHeight = Math.min(height, room);
    const maxLeft = document.documentElement.clientWidth - width - VIEWPORT_MARGIN_PX;
    panel.style.maxHeight = `${room}px`;
    panel.style.top = `${
      above ? anchor.top - PANEL_GAP_PX - shownHeight : anchor.bottom + PANEL_GAP_PX
    }px`;
    panel.style.left = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.left, maxLeft))}px`;
  }, [customized, options.length, triggerRef]);

  useEffect(() => {
    const panel = panelRef.current;
    const initial =
      panel?.querySelector<HTMLButtonElement>("[data-active='true']") ??
      panel?.querySelector<HTMLButtonElement>("button");
    initial?.focus({ preventScroll: true });

    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      (panel?.contains(target) === true || triggerRef.current?.contains(target) === true);
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) onClose(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose(true);
    };
    // 浮层是 fixed 的，页面一滚就和线路名脱开了；与其跟着重算位置，不如直接收起。
    const onScroll = (event: Event) => {
      if (!isInside(event.target)) onClose(false);
    };
    const onResize = () => onClose(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose, triggerRef]);

  const select = (taskId: number) => {
    const next: PingLineOverrides = single
      ? withSingleLineOverride(overrides, taskId === singleDefault ? null : taskId)
      : switchPingLine(nodeDefault, overrides, slot, taskId);
    setPingLineOverrides(uuid, next);
    onClose(true);
  };

  // 只恢复这一种：单线路菜单不动多线路的行，反过来也一样。
  const reset = () => {
    setPingLineOverrides(
      uuid,
      single ? withSingleLineOverride(overrides, null) : withoutMultiLineOverrides(overrides),
    );
    onClose(true);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // 浮层挂在 body 末尾，Tab 出去会跳到页面最后；收起并回到线路名，Tab 顺序才接得上卡片。
    if (event.key === "Tab") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (current <= 0 ? items.length : current) - 1
            : (current + 1) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      className="ping-line-menu"
      role="group"
      aria-label={t("switcher.title")}
      onKeyDown={handleKeyDown}
    >
      {options.map((taskId) => {
        const active = taskId === currentTaskId;
        // 已经在别的行显示的线路：选它是两行互换，不会画出两行一样的。
        const swaps = !active && displayed.includes(taskId);
        return (
          <button
            key={taskId}
            type="button"
            className="ping-line-menu-item"
            data-active={active ? "true" : "false"}
            aria-current={active ? "true" : undefined}
            onClick={() => select(taskId)}
          >
            <span className="ping-line-menu-label">{carrierTaskName(taskId, carrierNames)}</span>
            {swaps && <span className="ping-line-menu-hint">{t("switcher.swap")}</span>}
            {active && <Check size={14} aria-hidden />}
          </button>
        );
      })}
      {customized && (
        <>
          <div className="ping-line-menu-divider" role="separator" />
          <button
            type="button"
            className="ping-line-menu-item"
            title={t("switcher.resetTitle")}
            onClick={reset}
          >
            <RotateCcw size={13} aria-hidden />
            <span className="ping-line-menu-label">{t("switcher.reset")}</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
