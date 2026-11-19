import { useId, type ReactNode } from "react";
import {
  Building2,
  Link2,
  MapPin,
  Star,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { Link } from "react-aria-components/Link";
import { useRouter } from "@tanstack/react-router";
import { githubUrl, profileWebUrl, toAppPath } from "@/data/links";
import { useIsOffline } from "@/data/status";
import { useFollow, useProfile, useProfileReadme, type UserProfile } from "@/data/users";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { SafeHtml } from "@/markdown/SafeHtml.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Button } from "@/ui/Button.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { showErrorToast } from "@/ui/error-toast.ts";
import { EditProfileButton } from "./EditProfile.tsx";
import { RepoRow } from "./RepoRow.tsx";
import styles from "./Profile.module.css";

const HEADER_AVATAR_PX = 64;
const WEB_SCHEME = /^https?:\/\//;

function FollowButton(props: { profile: UserProfile }) {
  const t = useT();
  const follow = useFollow();
  const { login, viewerIsFollowing } = props.profile;
  const toggle = (next: boolean) => {
    follow.mutate(
      { login, follow: next },
      {
        onError: (error) => {
          showErrorToast(
            t,
            error,
            t(next ? "account.follow.followFailed" : "account.follow.unfollowFailed"),
            () => {
              toggle(next);
            },
          );
        },
      },
    );
  };
  return (
    <Button
      variant={viewerIsFollowing ? "secondary" : "primary"}
      icon={viewerIsFollowing ? <UserCheck aria-hidden /> : <UserPlus aria-hidden />}
      onPress={() => {
        toggle(!viewerIsFollowing);
      }}
    >
      {viewerIsFollowing ? t("account.follow.following") : t("account.follow.follow")}
    </Button>
  );
}

function ProfileHeader(props: { profile: UserProfile }) {
  const t = useT();
  const formatters = useFormatters();
  const { profile } = props;
  const website = profileWebUrl(profile.websiteUrl);
  const share = async () => {
    const url = githubUrl(`/${profile.login}`);
    try {
      if (typeof navigator.share === "function")
        await navigator.share({ url, title: profile.name ?? profile.login });
      else {
        await navigator.clipboard.writeText(url);
        showToast(t("common.copied"));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showToast(t("account.profile.shareFailed"));
    }
  };
  const stats = [
    ["repositories", profile.repositoryCount],
    ["followers", profile.followers],
    ["following", profile.following],
  ] as const;
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <Avatar src={profile.avatarUrl} name={profile.login} size={HEADER_AVATAR_PX} />
        <div className={styles.stats}>
          {stats
            .filter(([kind]) => !profile.isOrganization || kind === "repositories")
            .map(([kind, count]) => (
              <Link
                className={moduleClass(styles.stat)}
                key={kind}
                href={`/${profile.login}?tab=${kind}`}
              >
                {count !== undefined ? <strong>{formatters.number(count)}</strong> : null}
                <span>{t(`account.lists.${kind}`)}</span>
              </Link>
            ))}
        </div>
      </div>
      <div className={styles.names}>
        <p className={styles.name}>{profile.name || profile.login}</p>
        {profile.name ? <p className={styles.login}>@{profile.login}</p> : null}
      </div>
      {profile.bio ? <p className={styles.bio}>{profile.bio}</p> : null}
      <ul className={styles.facts}>
        {profile.company ? (
          <li>
            <Building2 aria-hidden />
            <span className={styles.srOnly}>{t("account.profile.company")}</span>
            {profile.company}
          </li>
        ) : null}
        {profile.location ? (
          <li>
            <MapPin aria-hidden />
            <span className={styles.srOnly}>{t("account.profile.location")}</span>
            {profile.location}
          </li>
        ) : null}
        {website ? (
          <li>
            <Link2 aria-hidden />
            <a href={website.href} target="_blank" rel="noopener noreferrer">
              {website.href.replace(WEB_SCHEME, "").replace(/\/$/, "")}
            </a>
          </li>
        ) : null}
        {profile.socialAccounts?.map((social) => {
          const address = profileWebUrl(social.url);
          return address ? (
            <li key={address.href}>
              <Link2 aria-hidden />
              <a href={address.href} target="_blank" rel="noopener noreferrer">
                {social.displayName || address.hostname}
              </a>
            </li>
          ) : null;
        })}
      </ul>
      <div className={styles.actions}>
        {profile.isViewer ? (
          <EditProfileButton />
        ) : profile.isOrganization ? null : (
          <FollowButton profile={profile} />
        )}
        <Button onPress={() => void share()}>{t("account.profile.share")}</Button>
      </div>
    </header>
  );
}

function Readme(props: { profile: UserProfile }) {
  const t = useT();
  const router = useRouter();
  const offline = useIsOffline();
  const titleId = useId();
  const readme = useProfileReadme(
    props.profile.login,
    props.profile.hasPublicReadmeRepository === true,
  );
  if (props.profile.hasPublicReadmeRepository === false) return null;
  // Older offline snapshots embed the README.
  const html =
    props.profile.hasPublicReadmeRepository === undefined ? props.profile.readmeHtml : readme.data;
  if (props.profile.hasPublicReadmeRepository && readme.isError) {
    return <ErrorState error={readme.error} onRetry={() => void readme.refetch()} />;
  }
  if (!html) return null;
  return (
    <section className={styles.readme} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.readmeTitle}>
        {props.profile.login} / README.md
      </h2>
      <SafeHtml
        html={html}
        className={moduleClass(styles.readmeBody)}
        toAppPath={toAppPath}
        onNavigate={(path) => {
          router.history.push(path);
        }}
        offline={offline}
        offlineImageLabel={t("account.profile.offlineImage")}
      />
    </section>
  );
}

function ProfileSkeleton() {
  return (
    <div className={styles.header} aria-busy="true">
      <div className={styles.identity}>
        <Skeleton
          width={`${String(HEADER_AVATAR_PX)}px`}
          height={`${String(HEADER_AVATAR_PX)}px`}
          round
        />
        <div className={styles.names}>
          <Skeleton width="10rem" height="1.5rem" />
          <Skeleton width="6rem" height="1rem" />
        </div>
      </div>
      <Skeleton width="100%" height="3rem" />
      <Spinner size="small" />
    </div>
  );
}

export function ProfileView(props: { login: string; children?: ReactNode }) {
  const t = useT();
  const query = useProfile(props.login);
  const pinnedId = useId();
  if (query.isPending) {
    return (
      <>
        <ProfileSkeleton />
        {props.children}
      </>
    );
  }
  if (query.isLoadingError) {
    return (
      <>
        <ErrorState
          error={query.error}
          fullScreen={isFullScreenError(query.error)}
          onRetry={() => void query.refetch()}
        />
        {props.children}
      </>
    );
  }
  const profile = query.data;
  const base = `/${profile.login}`;
  return (
    <>
      <ProfileHeader profile={profile} />
      {query.isRefetchError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <nav className={styles.profileLinks} aria-label={t("account.profile.sections")}>
        <span className={styles.current}>
          <UserRound aria-hidden /> {t("account.profile.overview")}
        </span>
        <Link
          className={moduleClass(styles.profileLink)}
          href={`${base}?tab=${profile.isOrganization ? "members" : "stars"}`}
        >
          {profile.isOrganization ? <Users aria-hidden /> : <Star aria-hidden />}
          {t(profile.isOrganization ? "account.lists.members" : "account.lists.starred")}
        </Link>
      </nav>
      {profile.pinned.length > 0 ? (
        <section className={styles.section} aria-labelledby={pinnedId}>
          <h2 id={pinnedId} className={styles.sectionTitle}>
            {t("account.profile.pinned")}
          </h2>
          <ul className={styles.card}>
            {profile.pinned.map((repo) => (
              <li key={`${repo.owner}/${repo.name}`} className={styles.cardItem}>
                <RepoRow repo={repo} showOwner={repo.owner !== profile.login} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {props.children}
      <Readme profile={profile} />
    </>
  );
}
