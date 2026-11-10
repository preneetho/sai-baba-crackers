import { youtubeVideoId } from "./media-model.mjs";

export const DEFAULT_HOMEPAGE_VIDEO = Object.freeze({ videoId: "hxVU6MC47zU" });
export const validHomepageVersion = value => value === null ||
  (typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value));

export function validHomepageVideo(video) {
  return Boolean(video && typeof video === "object" && !Array.isArray(video) &&
    Object.keys(video).length === 1 && Object.hasOwn(video, "videoId") &&
    (video.videoId === null || (typeof video.videoId === "string" &&
      youtubeVideoId(`https://youtu.be/${video.videoId}`) === video.videoId)));
}

export function homepageVideoFromUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Enter a valid HTTPS YouTube video link, or leave it blank to hide the video.");
  }
  if (!value.trim()) return { videoId: null };
  const videoId = youtubeVideoId(value);
  if (!videoId) throw new Error("Use an HTTPS YouTube watch, Shorts or youtu.be link.");
  return { videoId };
}

export function homepageVideoUrl(video) {
  if (!validHomepageVideo(video)) throw new Error("The homepage video settings could not be verified.");
  return video.videoId === null ? "" : `https://www.youtube.com/watch?v=${video.videoId}`;
}
