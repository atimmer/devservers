import type { ServiceInfo } from "@24letters/devservers-shared";

export const orderServices = (services: ServiceInfo[]) => {
  const scored = services.map((service, index) => ({ service, index }));
  const scoreLastStartedAt = (service: ServiceInfo) => {
    if (!service.lastStartedAt) {
      return 0;
    }
    const parsed = Date.parse(service.lastStartedAt);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  scored.sort((left, right) => {
    const leftRunning = left.service.status === "running";
    const rightRunning = right.service.status === "running";
    if (leftRunning !== rightRunning) {
      return leftRunning ? -1 : 1;
    }

    if (!leftRunning) {
      const timeDelta = scoreLastStartedAt(right.service) - scoreLastStartedAt(left.service);
      if (timeDelta !== 0) {
        return timeDelta;
      }
    }

    return left.index - right.index;
  });

  return scored.map(({ service }) => service);
};
