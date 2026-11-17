import { openExternal } from "@/ui/external.ts";
import { useState } from "react";
import { Code, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { useT } from "@/i18n/index.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Sheet } from "@/ui/Sheet.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import appLicense from "../../../../LICENSE?raw";
import licenses from "../licenses.json";
import styles from "../Settings.module.css";

const MARK_SIZE_PX = 72;
const LICENSE_ROW_ESTIMATE_PX = 60;

interface LicenseText {
  title: string;
  text: string;
}

function readSourceUrl(): string | null {
  const configured: unknown = import.meta.env.VITE_GHM_SOURCE_URL;
  return typeof configured === "string" && configured.startsWith("https://") ? configured : null;
}

const SOURCE_URL = readSourceUrl();

export default function AboutSection() {
  const t = useT();
  const [shown, setShown] = useState<LicenseText | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const show = (license: LicenseText) => {
    setShown(license);
    setSheetOpen(true);
  };

  return (
    <>
      <div className={styles.about}>
        <img
          className={styles.aboutMark}
          src="/icon.svg"
          alt=""
          width={MARK_SIZE_PX}
          height={MARK_SIZE_PX}
        />
        <p className={styles.aboutName}>{t("app.title")}</p>
        <p className={styles.aboutLine}>
          {t("settings.about.version", { version: licenses.appVersion })}
        </p>
        <p className={styles.aboutLine}>{t("app.unofficial")}</p>
      </div>
      <ListSection footer={t("settings.about.notAffiliated")}>
        <ListRow
          leading={<FileText aria-hidden />}
          title={t("settings.about.license")}
          detail="MIT"
          onPress={() => {
            show({ title: t("settings.about.license"), text: appLicense });
          }}
        />
        {SOURCE_URL ? (
          <ListRow
            leading={<Code aria-hidden />}
            title={t("settings.about.source")}
            trailing={<ExternalLink aria-hidden className={styles.muted} />}
            onPress={() => {
              openExternal(SOURCE_URL);
            }}
          />
        ) : (
          <ListRow
            leading={<Code aria-hidden />}
            title={t("settings.about.source")}
            subtitle={t("settings.about.sourcePending")}
          />
        )}
        <ListRow
          leading={<ShieldCheck aria-hidden />}
          title={t("settings.about.privacy")}
          subtitle={t("settings.about.privacyDetail")}
        />
      </ListSection>
      <ListSection
        title={t("settings.about.thirdParty")}
        footer={t("settings.about.thirdPartyFooter", { count: licenses.packages.length })}
      >
        <li>
          <VirtualList
            separators
            items={licenses.packages}
            label={t("settings.about.thirdParty")}
            estimateSize={LICENSE_ROW_ESTIMATE_PX}
            getKey={(entry) => entry.name}
            renderItem={(entry) => (
              <AriaButton
                className={moduleClass(styles.licenseRow)}
                isDisabled={entry.text === null}
                onPress={() => {
                  if (entry.text !== null) {
                    show({ title: `${entry.name} ${entry.version}`, text: entry.text });
                  }
                }}
              >
                <span className={styles.licenseName}>{entry.name}</span>
                <span className={styles.licenseMeta}>
                  {entry.version} · {entry.license}
                </span>
              </AriaButton>
            )}
          />
        </li>
      </ListSection>
      <Sheet isOpen={sheetOpen} onOpenChange={setSheetOpen} title={shown?.title ?? ""}>
        <pre className={styles.licenseText}>{shown?.text}</pre>
      </Sheet>
    </>
  );
}
