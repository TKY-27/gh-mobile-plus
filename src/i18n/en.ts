import common from "./messages/en/common.json";
import app from "./messages/en/app.json";
import onboarding from "./messages/en/onboarding.json";
import settings from "./messages/en/settings.json";
import home from "./messages/en/home.json";
import work from "./messages/en/work.json";
import inbox from "./messages/en/inbox.json";
import search from "./messages/en/search.json";
import account from "./messages/en/account.json";
import repo from "./messages/en/repo.json";
import code from "./messages/en/code.json";
import issue from "./messages/en/issue.json";
import pull from "./messages/en/pull.json";
import review from "./messages/en/review.json";
import actions from "./messages/en/actions.json";
import errors from "./messages/en/errors.json";

const catalog = {
  common,
  app,
  onboarding,
  settings,
  home,
  work,
  inbox,
  search,
  account,
  repo,
  code,
  issue,
  pull,
  review,
  actions,
  errors,
};

export type Catalog = typeof catalog;

export default catalog;
