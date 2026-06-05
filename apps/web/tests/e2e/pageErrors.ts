export function collectRelevantPageErrors(page: {
  on(event: "pageerror", handler: (error: Error) => void): void;
}) {
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    if (isKnownNoisyPageError(error)) {
      return;
    }

    pageErrors.push(error.message);
  });

  return pageErrors;
}

function isKnownNoisyPageError(error: Error) {
  if (error.name === "SyntaxError" && error.message === "Invalid or unexpected token" && !error.stack) {
    return true;
  }
  // Dev mode hydration warnings
  if (error.message.includes("Hydration failed") || error.message.includes("hydration-mismatch")) {
    return true;
  }
  // Production build minified hydration errors — caused by SSR rendering disconnected
  // state while client reads localStorage mock wallet and hydrates connected state.
  // #418: hydration mismatch, #423: root switched to client rendering, #425: text mismatch
  if (/Minified React error #(418|423|425)/.test(error.message)) {
    return true;
  }
  return false;
}
