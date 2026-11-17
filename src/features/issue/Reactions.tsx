import { SmilePlus } from "lucide-react";
import { ToggleButton } from "react-aria-components/ToggleButton";
import { useToggleReaction } from "@/data/issues";
import type { ReactionContent, ReactionGroup } from "@/data/types";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { IconButton } from "@/ui/Button.tsx";
import { Menu } from "@/ui/Menu.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import styles from "./Conversation.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const REACTIONS: readonly { content: ReactionContent; emoji: string; name: MessageKey }[] = [
  { content: "THUMBS_UP", emoji: "👍", name: "issue.reaction.thumbsUp" },
  { content: "THUMBS_DOWN", emoji: "👎", name: "issue.reaction.thumbsDown" },
  { content: "LAUGH", emoji: "😄", name: "issue.reaction.laugh" },
  { content: "HOORAY", emoji: "🎉", name: "issue.reaction.hooray" },
  { content: "CONFUSED", emoji: "😕", name: "issue.reaction.confused" },
  { content: "HEART", emoji: "❤️", name: "issue.reaction.heart" },
  { content: "ROCKET", emoji: "🚀", name: "issue.reaction.rocket" },
  { content: "EYES", emoji: "👀", name: "issue.reaction.eyes" },
];

export function Reactions(props: {
  subjectId: string;
  groups: readonly ReactionGroup[];
  canReact: boolean;
}) {
  const t = useT();
  const toggle = useToggleReaction();
  const { subjectId } = props;
  const visible = REACTIONS.flatMap((reaction) => {
    const group = props.groups.find((candidate) => candidate.content === reaction.content);
    return group && group.count > 0 ? [{ ...reaction, group }] : [];
  });

  const react = (content: ReactionContent, add: boolean) => {
    toggle.mutate(
      { subjectId, content, add },
      {
        onError: (error) => {
          showErrorToast(t, error, t("issue.reaction.failed"), () => {
            react(content, add);
          });
        },
      },
    );
  };

  if (visible.length === 0 && !props.canReact) return null;
  return (
    <div className={styles.reactions}>
      {visible.map(({ content, emoji, name, group }) => (
        <ToggleButton
          key={content}
          className={moduleClass(styles.reaction)}
          isSelected={group.viewerHasReacted}
          isDisabled={!props.canReact}
          aria-label={t("issue.reaction.chip", { reaction: t(name), count: group.count })}
          onChange={(add) => {
            react(content, add);
          }}
        >
          <span aria-hidden>{emoji}</span>
          <span aria-hidden>{group.count}</span>
        </ToggleButton>
      ))}
      {props.canReact ? (
        <Menu
          label={t("issue.reaction.add")}
          actions={REACTIONS.map(({ content, emoji, name }) => {
            const reacted = props.groups.some(
              (group) => group.content === content && group.viewerHasReacted,
            );
            const reaction = `${emoji} ${t(name)}`;
            return {
              id: content,
              label: reacted ? t("issue.reaction.remove", { reaction }) : reaction,
              onAction: () => {
                react(content, !reacted);
              },
            };
          })}
        >
          <IconButton label={t("issue.reaction.add")}>
            <SmilePlus aria-hidden />
          </IconButton>
        </Menu>
      ) : null}
    </div>
  );
}
