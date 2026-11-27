import { ArrowDownIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatAuxNewPostsFloat, formatAuxShowEarlier, getAuxStrings } from "./agentAux.i18n";
import {
  formatAuxClockTime,
  type AgentAuxBoardMessage,
  type AgentAuxMember,
  type AgentAuxViewModel,
} from "./agentAux.logic";
import { AgentAuxMarkdown } from "./AgentAuxMarkdown";
import { AgentMemberAvatar } from "./SwarmBeeSprite";

export interface AgentAuxBoardTabProps {
  readonly model: AgentAuxViewModel;
  readonly senderFilter: string;
  readonly onChangeSenderFilter: (sender: string) => void;
  readonly flashSeq: number | null;
  readonly onJumpSeq: (seq: number) => void;
  readonly onClearFlash: () => void;
  readonly scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

const BOARD_INITIAL_WINDOW = 60;
const BOARD_PAGE_STEP = 60;

export const AgentAuxBoardTab = memo(function AgentAuxBoardTab({
  model,
  senderFilter,
  onChangeSenderFilter,
  flashSeq,
  onJumpSeq,
  onClearFlash,
  scrollContainerRef,
}: AgentAuxBoardTabProps) {
  const s = getAuxStrings(model.locale);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recipientFilter, setRecipientFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [hiddenMembers, setHiddenMembers] = useState<ReadonlySet<string>>(() => new Set());
  const [autoFollow, setAutoFollow] = useState(true);
  const [windowSize, setWindowSize] = useState(BOARD_INITIAL_WINDOW);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [seenLatestSeq, setSeenLatestSeq] = useState(model.headSeq);

  const prevMsgLenRef = useRef(model.messages.length);

  const teamMembers = useMemo(() => model.members.filter((m) => !m.isSystem), [model.members]);
  const memberByName = useMemo(
    () => new Map<string, AgentAuxMember>(teamMembers.map((m) => [m.name, m])),
    [teamMembers],
  );
  const knownNames = useMemo(() => new Set(model.members.map((m) => m.name)), [model.members]);

  const visibleMessages = useMemo(
    () => model.messages.filter((m) => !m.isControl),
    [model.messages],
  );

  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleMessages.filter((msg) => {
      if (hiddenMembers.has(msg.agent)) return false;
      if (senderFilter && msg.agent !== senderFilter) return false;
      if (channelFilter) {
        const msgChannel = msg.channel || "main";
        if (msgChannel !== channelFilter) return false;
      }
      if (recipientFilter) {
        if (recipientFilter === "__all__") {
          if (!msg.all) return false;
        } else if (msg.recipient !== recipientFilter && !msg.mentions.includes(recipientFilter)) {
          return false;
        }
      }
      if (q) {
        const seqHit = `#${msg.seq}`.includes(q);
        const hay =
          `${msg.agent} ${msg.recipient ?? ""} ${msg.mentions.join(" ")} ${msg.text} ${msg.summary ?? ""}`.toLowerCase();
        if (!seqHit && !hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleMessages, hiddenMembers, senderFilter, recipientFilter, channelFilter, search]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    senderFilter.length > 0 ||
    recipientFilter.length > 0 ||
    channelFilter.length > 0 ||
    hiddenMembers.size > 0;

  // Ensure flashSeq is always within the rendered window
  const effectiveWindow = useMemo(() => {
    if (flashSeq === null) return windowSize;
    const idx = filteredMessages.findIndex((m) => m.seq === flashSeq);
    if (idx < 0) return windowSize;
    const needed = filteredMessages.length - idx + 5;
    return Math.max(windowSize, needed);
  }, [flashSeq, filteredMessages, windowSize]);

  const hiddenEarlierCount = Math.max(0, filteredMessages.length - effectiveWindow);
  const displayedMessages = useMemo(
    () => (hiddenEarlierCount > 0 ? filteredMessages.slice(hiddenEarlierCount) : filteredMessages),
    [filteredMessages, hiddenEarlierCount],
  );

  const firstUnreadSeq = useMemo(() => {
    if (model.unreadSeqBoundary === null) return null;
    const found = displayedMessages.find((m) => m.isUnread);
    return found?.seq ?? null;
  }, [displayedMessages, model.unreadSeqBoundary]);

  const unreadNewWhileScrolled = useMemo(() => {
    if (!scrolledUp) return 0;
    return visibleMessages.filter((m) => m.seq > seenLatestSeq).length;
  }, [scrolledUp, visibleMessages, seenLatestSeq]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to host container scroll position to toggle jump-to-latest pill
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isUp = dist > 72;
      setScrolledUp(isUp);
      if (!isUp) {
        setSeenLatestSeq(model.headSeq);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollContainerRef, model.headSeq]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- imperative DOM scroll-to-bottom when auto-following new board messages
  useEffect(() => {
    const grew = model.messages.length > prevMsgLenRef.current;
    prevMsgLenRef.current = model.messages.length;
    if (!grew || !autoFollow || scrolledUp) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const raf = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      setSeenLatestSeq(model.headSeq);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [model.messages.length, model.headSeq, autoFollow, scrolledUp, scrollContainerRef]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- imperative scrollIntoView + highlight timeout for jumped #seq message
  useEffect(() => {
    if (flashSeq === null) return;
    const timer = window.setTimeout(() => {
      const container = scrollContainerRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-aux-seq="${flashSeq}"]`);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 30);
    const clearTimer = window.setTimeout(onClearFlash, 1750);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [flashSeq, onClearFlash, scrollContainerRef]);

  const jumpToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    setAutoFollow(true);
    setScrolledUp(false);
    setSeenLatestSeq(model.headSeq);
  }, [scrollContainerRef, model.headSeq]);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    onChangeSenderFilter("");
    setRecipientFilter("");
    setChannelFilter("");
    setHiddenMembers(new Set());
  }, [onChangeSenderFilter]);

  const toggleHiddenMember = useCallback((name: string) => {
    setHiddenMembers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const renderRecipients = (msg: AgentAuxBoardMessage) => {
    const targets: string[] = [];
    if (msg.recipient && msg.recipient !== msg.agent) targets.push(msg.recipient);
    for (const m of msg.mentions) {
      if (m !== msg.agent && !targets.includes(m)) targets.push(m);
    }
    if (msg.all) {
      targets.push("all");
    }
    if (targets.length === 0) return null;
    const shown = targets.slice(0, 3);
    const extra = targets.length - shown.length;
    return (
      <span className="pmx-aux-msg-to">
        <span aria-hidden="true">→</span>{" "}
        {shown.map((t, idx) => (
          <span key={t}>
            {idx > 0 ? " " : ""}
            {t === "all" ? (
              <span className="pmx-aux-mention pmx-aux-mention--all">@all</span>
            ) : (
              <button
                type="button"
                className="pmx-aux-msg-target-btn"
                onClick={() => onChangeSenderFilter(senderFilter === t ? "" : t)}
              >
                @{t}
              </button>
            )}
          </span>
        ))}
        {extra > 0 ? <span className="text-muted-foreground"> +{extra}</span> : null}
      </span>
    );
  };

  return (
    <div className="pmx-aux-board-root" data-aux-section="board">
      {/* Sticky Search, Channels & Collapsible Filters (ZERO nested backdrop-filter!) */}
      <div className="pmx-aux-toolbar">
        <div className="pmx-aux-search-row">
          <label className="pmx-aux-search">
            <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={s.boardSearchPlaceholder}
              aria-label={s.boardSearchAria}
            />
            {search ? (
              <button
                type="button"
                className="pmx-aux-search-clear"
                aria-label={s.boardClearFilters}
                onClick={() => setSearch("")}
              >
                <XIcon className="size-3" />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className={`pmx-aux-icon-btn pmx-aux-filter-toggle${filtersOpen ? " pmx-aux-icon-btn--on" : ""}`}
            aria-expanded={filtersOpen}
            aria-label={s.boardFiltersAria}
            title={s.boardFiltersTitle}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontalIcon className="size-3.5" />
            {hasActiveFilters ? <i className="pmx-aux-filter-dot" aria-hidden="true" /> : null}
          </button>
        </div>

        {/* Channel tabs when swarm has channels */}
        {model.channels.length > 0 ? (
          <div className="pmx-aux-chips" role="group" aria-label={s.boardAllChannels}>
            <button
              type="button"
              className={`pmx-aux-chip${channelFilter === "" ? "" : " pmx-aux-chip--dim"}`}
              onClick={() => setChannelFilter("")}
            >
              {s.boardAllChannels}
            </button>
            <button
              type="button"
              className={`pmx-aux-chip${channelFilter === "main" ? "" : " pmx-aux-chip--dim"}`}
              onClick={() => setChannelFilter(channelFilter === "main" ? "" : "main")}
            >
              {s.boardMainChannel}
            </button>
            {model.channels.map((ch) => (
              <button
                key={ch}
                type="button"
                className={`pmx-aux-chip${channelFilter === ch ? "" : " pmx-aux-chip--dim"}`}
                onClick={() => setChannelFilter(channelFilter === ch ? "" : ch)}
              >
                #{ch}
              </button>
            ))}
          </div>
        ) : null}

        {/* Active sender chip shortcut even when filter drawer is collapsed */}
        {!filtersOpen && (senderFilter || recipientFilter || hiddenMembers.size > 0) ? (
          <div className="pmx-aux-active-filters">
            {senderFilter ? (
              <span className="pmx-aux-active-tag">
                @{senderFilter}
                <button
                  type="button"
                  aria-label={s.boardClearFilters}
                  onClick={() => onChangeSenderFilter("")}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ) : null}
            {recipientFilter ? (
              <span className="pmx-aux-active-tag">
                → {recipientFilter === "__all__" ? "@all" : `@${recipientFilter}`}
                <button
                  type="button"
                  aria-label={s.boardClearFilters}
                  onClick={() => setRecipientFilter("")}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ) : null}
            <button type="button" className="pmx-aux-link-btn ml-auto" onClick={clearAllFilters}>
              {s.boardClearFilters}
            </button>
          </div>
        ) : null}

        {/* Collapsible filter drawer */}
        {filtersOpen ? (
          <div className="pmx-aux-filters" data-testid="aux-board-filters">
            <div className="pmx-aux-filter-row">
              <select
                className="pmx-aux-select"
                value={senderFilter}
                aria-label={s.boardSenderAll}
                onChange={(e) => onChangeSenderFilter(e.target.value)}
              >
                <option value="">{s.boardSenderAll}</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.name}>
                    @{m.name}
                  </option>
                ))}
              </select>
              <select
                className="pmx-aux-select"
                value={recipientFilter}
                aria-label={s.boardRecipientAll}
                onChange={(e) => setRecipientFilter(e.target.value)}
              >
                <option value="">{s.boardRecipientAll}</option>
                <option value="__all__">{s.boardBroadcastAllOption}</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.name}>
                    @{m.name}
                  </option>
                ))}
              </select>
              <label className="pmx-aux-switch ml-auto">
                <input
                  type="checkbox"
                  checked={autoFollow}
                  onChange={(e) => setAutoFollow(e.target.checked)}
                />
                <span>{s.boardFollowLabel}</span>
              </label>
            </div>

            {teamMembers.length > 0 ? (
              <div className="pmx-aux-chips">
                {teamMembers.slice(0, 20).map((m) => {
                  const hidden = hiddenMembers.has(m.name);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={hidden ? "pmx-aux-chip pmx-aux-chip--dim" : "pmx-aux-chip"}
                      aria-pressed={!hidden}
                      onClick={() => toggleHiddenMember(m.name)}
                    >
                      @{m.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Load Earlier Pagination */}
      {hiddenEarlierCount > 0 ? (
        <button
          type="button"
          className="pmx-aux-earlier-btn"
          onClick={() => setWindowSize((n) => n + BOARD_PAGE_STEP)}
        >
          {formatAuxShowEarlier(hiddenEarlierCount, model.locale)}
        </button>
      ) : null}

      {/* Message Feed */}
      {displayedMessages.length === 0 ? (
        <div className="pmx-aux-empty-inline">
          <p>{hasActiveFilters ? s.boardEmptyFiltered : s.boardEmpty}</p>
          {hasActiveFilters ? (
            <button type="button" className="pmx-aux-btn mt-2" onClick={clearAllFilters}>
              {s.boardClearFilters}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="pmx-aux-feed" data-testid="aux-board-feed">
          {displayedMessages.map((msg) => {
            const sender = memberByName.get(msg.agent);
            const isSwarmBee =
              model.useBees &&
              (sender ? sender.sourceKind !== "acp-delegated" : msg.sourceKind !== "acp-delegated");
            const isAbsorbedAcp =
              model.useBees &&
              (msg.sourceKind === "acp-delegated" || sender?.sourceKind === "acp-delegated");
            const showUnreadDivider = firstUnreadSeq !== null && msg.seq === firstUnreadSeq;
            const clockStr = formatAuxClockTime(msg.ts, msg.time);

            return (
              <div key={`${msg.seq}-${msg.agent}`}>
                {showUnreadDivider ? (
                  <div className="pmx-aux-unread-divider" data-testid="aux-unread-divider">
                    <span>{s.boardNewDivider}</span>
                  </div>
                ) : null}
                <article
                  data-aux-seq={msg.seq}
                  className={[
                    "pmx-aux-msg",
                    !model.useBees ? "pmx-aux-msg--bare" : "",
                    msg.isUnread ? "pmx-aux-msg--unread" : "",
                    msg.isDirectToYou ? "pmx-aux-msg--direct" : "",
                    isAbsorbedAcp ? "pmx-aux-msg--acp" : "",
                    flashSeq === msg.seq ? "pmx-aux-msg--flash" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div
                    className={
                      isSwarmBee
                        ? "pmx-aux-msg-avatar pmx-aux-msg-avatar--bee"
                        : "pmx-aux-msg-avatar"
                    }
                  >
                    <AgentMemberAvatar
                      useBees={isSwarmBee}
                      providerBrand={
                        msg.providerBrand ?? sender?.providerBrand ?? model.providerBrand
                      }
                      name={msg.agent}
                      displayName={sender?.displayName ?? msg.agent}
                      status={sender?.status ?? "done"}
                      color={msg.color ?? sender?.color}
                      size="xs"
                      showStatusDot={false}
                      isCoordinator={sender?.isCoordinator ?? msg.agent === "coordinator"}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="pmx-aux-msg-head">
                      <div className="pmx-aux-msg-who">
                        <button
                          type="button"
                          className="pmx-aux-msg-author"
                          onClick={() =>
                            onChangeSenderFilter(senderFilter === msg.agent ? "" : msg.agent)
                          }
                        >
                          @{msg.agent}
                        </button>
                        {isAbsorbedAcp ? (
                          <span className="pmx-aux-acp-badge">{s.acpDelegatedBadge}</span>
                        ) : null}
                        {renderRecipients(msg)}
                        {msg.channel && msg.channel !== "main" ? (
                          <span className="pmx-aux-channel-tag">#{msg.channel}</span>
                        ) : null}
                      </div>
                      <span className="pmx-aux-msg-meta">
                        <button
                          type="button"
                          className="pmx-aux-msg-seq-link"
                          onClick={() => onJumpSeq(msg.seq)}
                        >
                          #{msg.seq}
                        </button>
                        {clockStr ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{clockStr}</span>
                          </>
                        ) : null}
                      </span>
                    </div>

                    <div className="pmx-aux-msg-body">
                      <AgentAuxMarkdown
                        text={msg.text}
                        knownNames={knownNames}
                        maxSeq={model.headSeq || visibleMessages.length}
                        mentions={msg.mentions}
                        all={msg.all}
                        stripLeadingMentions
                        clamp
                        locale={model.locale}
                        onJumpSeq={onJumpSeq}
                        onClickMention={(name) =>
                          onChangeSenderFilter(senderFilter === name ? "" : name)
                        }
                        {...(msg.screenshots ? { screenshots: msg.screenshots } : {})}
                      />
                    </div>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Jump-to-Latest Pill when scrolled up */}
      {scrolledUp ? (
        <div className="pmx-aux-jump-wrap">
          <button type="button" className="pmx-aux-jump-btn" onClick={jumpToBottom}>
            <ArrowDownIcon className="size-3.5" aria-hidden="true" />
            <span>
              {unreadNewWhileScrolled > 0
                ? formatAuxNewPostsFloat(unreadNewWhileScrolled, model.locale)
                : s.boardJumpLatest}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
});
