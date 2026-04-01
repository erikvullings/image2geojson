declare module 'imagetracerjs' {
  interface TracerOptions {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    colorsampling?: number;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    blurradius?: number;
    blurdelta?: number;
    scale?: number;
    simplifytolerance?: number;
    roundcoords?: number;
    lcpr?: number;
    qcpr?: number;
    desc?: boolean;
    viewbox?: boolean;
    strokewidth?: number;
  }

  interface ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  const ImageTracer: {
    /** Synchronous — returns SVG string directly */
    imagedataToSVG(imageData: ImageData, options?: TracerOptions): string;
    imageToSVG(url: string, callback: (svgstr: string) => void, options?: TracerOptions): void;
    imagedataToTracedata(imageData: ImageData, options?: TracerOptions): object;
  };

  export default ImageTracer;
}
