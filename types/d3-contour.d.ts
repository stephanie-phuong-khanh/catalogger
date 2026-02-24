declare module 'd3-contour' {
  export function contours(): {
    size(size: [number, number]): {
      contour(values: number[], threshold: number): {
        type: string;
        value: number;
        coordinates: number[][][][];
      };
    };
  };
}
