const express = require("express");
const path = require("path");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");

const app = express();
const PORT = 8000;

const videoListPath = path.join(__dirname, "videos.json");
const maxStorageMB = 1000;

app.use("/videos", express.static(path.join(__dirname, "videos")));
app.use(express.static(path.join(__dirname, "public")));


const storage = multer.diskStorage({
  destination: "./uploads",
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});


const upload = multer({
  storage: storage,
  limits: { fileSize: 1000000000 }, 
}).single("video");


const saveMetadata = (data) => {
  let videos = [];
  if (fs.existsSync(videoListPath)) {
    videos = JSON.parse(fs.readFileSync(videoListPath, "utf8"));
  }
  videos.push(data);
  fs.writeFileSync(videoListPath, JSON.stringify(videos, null, 2));
};

const getDirectorySize = (dir) => {
  const files = fs.readdirSync(dir);
  return files.reduce((total, file) => {
    const { size } = fs.statSync(path.join(dir, file));
    return total + size;
  }, 0);
};

const cleanupOldVideos = () => {
  if (!fs.existsSync(videoListPath)) return;

  const videos = JSON.parse(fs.readFileSync(videoListPath, "utf8"));
  const maxStorageBytes = maxStorageMB * 1024 * 1024;
  let storageUsed = getDirectorySize(path.join(__dirname, "videos"));

  if (storageUsed > maxStorageBytes) {
    videos.sort((a, b) => a.uploadedAt - b.uploadedAt); 
    for (let video of videos) {
      const videoPath = path.join(__dirname, "videos", video.name);
      fs.rmdirSync(videoPath, { recursive: true }); 
      storageUsed = getDirectorySize(path.join(__dirname, "videos"));
      if (storageUsed < maxStorageBytes) break;
    }
    fs.writeFileSync(
      videoListPath,
      JSON.stringify(
        videos.filter((v) =>
          fs.existsSync(path.join(__dirname, "videos", v.name))
        ),
        null,
        2
      )
    );
  }
};

setInterval(cleanupOldVideos, 3600000);

app.post("/upload", (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(500).json({ message: "Error uploading file" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const filePath = req.file.path;
    const fileName = path.parse(req.file.filename).name;
    const outputDir = path.join(__dirname, "videos", fileName);

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    ffmpeg(filePath)
      .output(`${outputDir}/output.m3u8`)
      .outputOptions([
        "-codec: copy",
        "-start_number 0",
        "-hls_time 10",
        "-hls_list_size 0",
        "-f hls",
      ])
      .on("end", () => {
        const videoData = {
          name: fileName,
          url: `/videos/${fileName}/output.m3u8`,
          uploadedAt: Date.now(),
        };
        saveMetadata(videoData);

        res.json({
          message: "File uploaded and converted",
          url: videoData.url,
        });

        fs.unlinkSync(filePath);
      })
      .on("error", (err) =>
        res
          .status(500)
          .json({ message: "Error converting video", error: err.message })
      )
      .run();
  });
});


app.get("/videos/list", (req, res) => {
  if (!fs.existsSync(videoListPath)) return res.json([]);

  const videos = JSON.parse(fs.readFileSync(videoListPath, "utf8"));
  res.json(videos);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
