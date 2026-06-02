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
  if (error.message.includes("Hydration failed") || error.message.includes("hydration-mismatch")) {
    return true;
  }
  return false;
}
