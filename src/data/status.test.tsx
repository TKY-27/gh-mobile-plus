import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useIsShowingCachedData } from "./status";

afterEach(cleanup);

function Banner() {
  return <p>{String(useIsShowingCachedData())}</p>;
}

function Screen() {
  useQuery({ queryKey: ["screen"], queryFn: () => 1, initialData: 1 });
  return null;
}

it("does not update the banner while another component renders", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const client = new QueryClient();
  const app = (withScreen: boolean) => (
    <QueryClientProvider client={client}>
      <Banner />
      {withScreen ? <Screen /> : null}
    </QueryClientProvider>
  );
  const { rerender } = render(app(false));
  rerender(app(true));
  expect(errors.mock.calls.flat().join(" ")).not.toMatch(/while rendering a different component/);
  errors.mockRestore();
});
