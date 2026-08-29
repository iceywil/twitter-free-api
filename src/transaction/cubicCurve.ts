/**
 * Ported from twikit/x_client_transaction/cubic_curve.py
 *
 * That module in turn derives from https://github.com/iSarabjitDhiman/TweeterPy —
 * with thanks to the original author.
 */

export class Cubic {
  constructor(private readonly curves: number[]) {}

  getValue(time: number): number {
    let startGradient = 0;
    let endGradient = 0;
    let start = 0;
    let mid = 0;
    let end = 1;

    if (time <= 0) {
      if (this.curves[0] > 0) {
        startGradient = this.curves[1] / this.curves[0];
      } else if (this.curves[1] === 0 && this.curves[2] > 0) {
        startGradient = this.curves[3] / this.curves[2];
      }
      return startGradient * time;
    }

    if (time >= 1) {
      if (this.curves[2] < 1) {
        endGradient = (this.curves[3] - 1) / (this.curves[2] - 1);
      } else if (this.curves[2] === 1 && this.curves[0] < 1) {
        endGradient = (this.curves[1] - 1) / (this.curves[0] - 1);
      }
      return 1 + endGradient * (time - 1);
    }

    while (start < end) {
      mid = (start + end) / 2;
      const xEst = Cubic.calculate(this.curves[0], this.curves[2], mid);
      if (Math.abs(time - xEst) < 0.00001) {
        return Cubic.calculate(this.curves[1], this.curves[3], mid);
      }
      if (xEst < time) {
        start = mid;
      } else {
        end = mid;
      }
    }
    return Cubic.calculate(this.curves[1], this.curves[3], mid);
  }

  static calculate(a: number, b: number, m: number): number {
    return 3.0 * a * (1 - m) * (1 - m) * m + 3.0 * b * (1 - m) * m * m + m * m * m;
  }
}
