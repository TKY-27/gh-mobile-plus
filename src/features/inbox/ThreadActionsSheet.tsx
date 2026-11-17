import { openExternal } from "@/ui/external.ts";
import { BellOff, Check, ExternalLink, MailOpen } from "lucide-react";
import type { InboxThread } from "@/data/inbox";
import { useT } from "@/i18n/index.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import type { SwipeAction } from "./swipe.ts";

const MAX_TITLE_CHARS = 80;

function sheetTitle(title: string): string {
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 1)}…` : title;
}

export function ThreadActionsSheet(props: {
  thread: InboxThread | null;
  isOpen: boolean;
  onClose: () => void;
  onAction: (thread: InboxThread, action: SwipeAction) => void;
  onUnsubscribe: (thread: InboxThread) => void;
}) {
  const t = useT();
  const { thread } = props;
  const run = (effect: (target: InboxThread) => void) => () => {
    if (!thread) return;
    props.onClose();
    effect(thread);
  };
  return (
    <Sheet
      isOpen={props.isOpen && thread !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={sheetTitle(thread?.title ?? "")}
    >
      {thread ? (
        <ListSection>
          <ListRow
            leading={<Check aria-hidden />}
            title={t("inbox.action.markDone")}
            onPress={run((target) => {
              props.onAction(target, "done");
            })}
          />
          {thread.unread ? (
            <ListRow
              leading={<MailOpen aria-hidden />}
              title={t("inbox.action.markRead")}
              onPress={run((target) => {
                props.onAction(target, "read");
              })}
            />
          ) : null}
          <ListRow
            leading={<BellOff aria-hidden />}
            title={t("inbox.action.unsubscribe")}
            onPress={run(props.onUnsubscribe)}
          />
          <ListRow
            leading={<ExternalLink aria-hidden />}
            title={t("common.openOnGitHub")}
            onPress={run((target) => {
              openExternal(target.webUrl);
            })}
          />
        </ListSection>
      ) : null}
    </Sheet>
  );
}
