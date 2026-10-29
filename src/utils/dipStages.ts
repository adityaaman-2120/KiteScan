/** The six classical digital image processing stages KiteScan uses, as shown on the About screen. */
export type DipStage = {
  id: string;
  title: string;
  /** One sentence in plain words. */
  summary: string;
  /** The OpenCV.js calls that implement it (all of them appear in the engine). */
  functions: string[];
};

export const DIP_STAGES: DipStage[] = [
  {
    id: 'enhancement',
    title: 'Image enhancement',
    summary: 'Fixes dull, unevenly lit photos so ink stands out, using local contrast equalisation, a levels stretch and a light sharpen.',
    functions: ['cv.CLAHE', 'cv.normalize', 'cv.convertTo', 'cv.addWeighted'],
  },
  {
    id: 'filtering',
    title: 'Filtering',
    summary: 'Smooths sensor noise before edges are traced, estimates the paper background, and measures sharpness to warn you about blurry photos.',
    functions: ['cv.GaussianBlur', 'cv.medianBlur', 'cv.Laplacian'],
  },
  {
    id: 'edges',
    title: 'Edge detection',
    summary: 'Finds where brightness and colour change sharply, scores every candidate page outline, and snaps the winning four sides onto the real edges.',
    functions: ['cv.Sobel', 'cv.Canny', 'cv.findContours', 'cv.approxPolyDP', 'cv.convexHull', 'cv.minAreaRect', 'cv.fitLine'],
  },
  {
    id: 'geometry',
    title: 'Geometric transform',
    summary: 'Straightens the page by mapping its four corners to a flat rectangle, and rotates and resizes it to keep every scan upright and compact.',
    functions: ['cv.getPerspectiveTransform', 'cv.warpPerspective', 'cv.rotate', 'cv.resize'],
  },
  {
    id: 'segmentation',
    title: 'Segmentation',
    summary: 'Separates ink from paper pixel by pixel with adaptive thresholding, finds the page against the desk with Otsu, and subtracts shadows.',
    functions: ['cv.adaptiveThreshold', 'cv.threshold', 'cv.absdiff', 'cv.bitwise_not'],
  },
  {
    id: 'morphology',
    title: 'Morphology',
    summary: 'Cleans shapes with small structuring elements: dilation closes gaps in edges, opening removes specks and closing fills tiny holes.',
    functions: ['cv.getStructuringElement', 'cv.dilate', 'cv.morphologyEx'],
  },
];

export const ABOUT = {
  appName: 'KiteScan',
  brand: 'Kitelux',
  tagline: 'Clean scans. Zero internet.',
  privacy: 'No internet. No account. Your images never leave this phone.',
  developer: 'Aditya Aman',
  institute: 'Heritage Institute of Technology',
} as const;
