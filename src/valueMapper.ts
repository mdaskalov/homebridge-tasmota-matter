import type { ClusterStateMap } from 'homebridge';

type ClusterValueMapper<K extends keyof ClusterStateMap> = (value: unknown) => Partial<ClusterStateMap[K]>;
type ClusterValueUnmapper = (attributes: unknown) => string;

type ClusterMappers = {
  [K in keyof ClusterStateMap]?: ClusterValueMapper<K>;
};

type ClusterUnmappers = {
  [K in keyof ClusterStateMap]?: ClusterValueUnmapper;
};

export class ValueMapper {
  private static readonly mappers: ClusterMappers = {
    onOff: (value) => ({
      onOff: value === 'ON' || value === true || value === 1,
    }),
    levelControl: (value) => ({
      currentLevel: Math.round((Number(value) / 100) * 254),
    }),
  };

  private static readonly unmappers: ClusterUnmappers = {
    levelControl: (attrs) => {
      const { level } = attrs as { level?: number };
      return String(Math.round(((level ?? 0) / 254) * 100));
    },
  };

  static toMatter<K extends keyof ClusterStateMap>(value: unknown, cluster: string): Partial<ClusterStateMap[K]> {
    const key = cluster as K;
    const mapper = this.mappers[key] as ClusterValueMapper<K> | undefined;
    if (!mapper) {
      throw new Error(`No value mapper registered for cluster: ${cluster}`);
    }
    return mapper(value);
  }

  static fromMatter(attributes: unknown, cluster: string): string | undefined {
    const unmapper = this.unmappers[cluster as keyof ClusterStateMap];
    if (unmapper) {
      return unmapper(attributes);
    }
  }

}