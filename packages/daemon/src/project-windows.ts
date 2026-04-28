export const matchProjectWindowNames = (windowNames: string[], projectNames: string[]) => {
  const prefixes = projectNames.map((projectName) => `${projectName}_`);
  return windowNames.filter((windowName) =>
    prefixes.some((prefix) => windowName.startsWith(prefix))
  );
};
