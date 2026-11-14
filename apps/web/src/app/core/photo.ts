const SIDE = 320;
const LIMIT = 170_000;

/** Crops the middle square of a picture and returns a small JPEG data URL. */
export function squarePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) {
      reject(new Error('Choose a picture, such as a JPG or PNG.'));
      return;
    }
    if (file.size > 15_000_000) {
      reject(new Error('That picture is over 15 MB. Choose a smaller one.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That picture could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That picture could not be opened. Try a JPG or PNG.'));
      image.onload = () => {
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        if (side < 48) {
          reject(new Error('That picture is too small.'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = SIDE;
        canvas.height = SIDE;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('This browser cannot resize pictures.'));
          return;
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, SIDE, SIDE);
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, SIDE, SIDE);
        let quality = 0.86;
        let data = canvas.toDataURL('image/jpeg', quality);
        while (data.length * 0.75 > LIMIT && quality > 0.4) {
          quality -= 0.12;
          data = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(data);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
